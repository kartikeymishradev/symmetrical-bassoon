/**
 * Serverless API Endpoint: REVA Health Verify Payment & Confirm Appointment
 * Route: POST /api/verify-payment
 *
 * 1. Validates required fields.
 * 2. Reads booking row from Sheets (authoritative source for order binding & status).
 * 3. Order-binding check: razorpay_order_id must match the booking's own order ID
 *    stored in Sheets — prevents a valid HMAC for one order confirming a different booking. (S8)
 * 4. SLOT_CONFLICT_CANCELLED guard: payment on cancelled slot → 409 + refund alert.
 * 5. SLOT_EXPIRED guard: payment after hold expired → 409 + refund alert. (S7)
 * 6. Idempotency guard: payment already in Payments tab → 200 with full booking details. (S5)
 * 7. Verifies Razorpay HMAC-SHA256 signature server-side.
 * 8. Appends transaction to 'Payments' tab.
 * 9. Delegates to lib/confirm-booking.js (conflict check, calendar, Sheets update, Telegram).
 * 10. WhatsApp confirmation hook (fire-and-forget).
 */

const https = require('https');
const { verifyPaymentSignature } = require('../lib/razorpay');
const { appendPayment, updateBookingPaymentStatus, isPaymentRecorded, getAllBookings } = require('../lib/sheets');
const { sendWhatsAppConfirmation } = require('../lib/whatsapp');
const { checkRateLimit } = require('../lib/ratelimit');
const { setCorsHeaders } = require('../lib/cors');
const { confirmBooking, escHtml } = require('../lib/confirm-booking');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'POST, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const rateCheck = checkRateLimit(req, res, 10, 60 * 1000);
  if (rateCheck.limited) {
    return res.status(429).json({ error: `Too many payment verification attempts. Please wait ${rateCheck.resetInSec} seconds before retrying.` });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      bookingId,
      date,
      time,
      name,
      phone,
      email,
      package: pkg,
      amount,
      calendarIdOverride
    } = body;

    // 1. Basic field validation
    if (!bookingId || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing required payment parameters.' });
    }

    // 2. Verify HMAC-SHA256 Signature FIRST
    const sigCheck = verifyPaymentSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature });
    if (!sigCheck.isValid) {
      return res.status(400).json({ error: 'Invalid payment signature. Payment verification failed.' });
    }

    // 3. Read booking row (authoritative source)
    let existingBooking = null;
    try {
      const { bookings } = await getAllBookings();
      existingBooking = (bookings || []).find(b => b.booking_id === bookingId);
    } catch (e) {
      console.warn('[verify-payment] Could not read existing booking:', e.message);
    }

    // Fail closed if row is missing or unreadable
    if (!existingBooking) {
      return res.status(404).json({ error: 'Booking not found or unreadable.' });
    }

    // Fail closed if razorpay_link_id is missing or doesn't match
    if (!existingBooking.razorpay_link_id) {
      return res.status(400).json({ error: 'Booking has no associated order.' });
    }
    if (existingBooking.razorpay_link_id !== razorpay_order_id) {
      console.warn(`[verify-payment] Order ID mismatch for booking=${bookingId}: expected=${existingBooking.razorpay_link_id} got=${razorpay_order_id}`);
      return res.status(400).json({ error: 'Payment order does not match this booking. Verification failed.' });
    }

    const authName = existingBooking.patient_name || 'N/A';
    const authPhone = existingBooking.phone_number || 'N/A';
    const authAmount = (existingBooking.amount && !isNaN(parseFloat(existingBooking.amount))) ? parseFloat(existingBooking.amount) : 400;

    // 4. SLOT_CONFLICT_CANCELLED guard
    if (existingBooking.appointment_status === 'SLOT_CONFLICT_CANCELLED') {
      await _sendRefundAlert({
        reason: 'SLOT_CONFLICT_CANCELLED',
        bookingId, name: authName,
        phone: authPhone,
        amount: authAmount,
        razorpay_payment_id, razorpay_order_id
      });
      return res.status(409).json({
        error: 'This booking slot was already reserved by another patient. Please contact support for a refund if payment was captured.'
      });
    }

    // 5. SLOT_EXPIRED guard (S7 fix)
    if (existingBooking.appointment_status === 'SLOT_EXPIRED') {
      await _sendRefundAlert({
        reason: 'SLOT_EXPIRED — hold had already expired when payment was captured',
        bookingId, name: authName,
        phone: authPhone,
        amount: authAmount,
        razorpay_payment_id, razorpay_order_id
      });
      return res.status(409).json({
        error: 'Your slot reservation had already expired before payment was captured. Your payment has been flagged for a full refund — we will contact you shortly.',
        expired: true
      });
    }

    // 6. Idempotency guard (S5 fix)
    const alreadyProcessed = await isPaymentRecorded(razorpay_payment_id, bookingId);
    if (alreadyProcessed) {
      return res.status(200).json({
        success:           true,
        idempotent:        true,
        bookingId,
        appointmentStatus: existingBooking.appointment_status || 'CONFIRMED',
        meetingLink:       existingBooking.calendar_event_id
                             ? `https://meet.google.com/${existingBooking.calendar_event_id}`
                             : '',
        message: 'Payment already processed and recorded previously.'
      });
    }

    const timestamp = new Date().toISOString();

    // 7. Append Transaction to 'Payments' tab
    const paymentId  = `PAY-${Date.now().toString(36).toUpperCase()}`;
    const paymentRow = [
      paymentId, bookingId, razorpay_payment_id, razorpay_order_id,
      authAmount, 'INR', 'captured', 'online',
      timestamp, 'payment.verify', timestamp
    ];

    let paySuccess = false;
    try {
      const payRes = await appendPayment(paymentRow);
      paySuccess = payRes.success;
    } catch (payErr) {
      console.error('[verify-payment] Error appending payment to Sheets:', payErr.message);
    }

    // 8. Delegate: conflict check, calendar creation, Bookings update, Telegram alert
    const confirmResult = await confirmBooking({
      bookingId,
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId:   razorpay_order_id,
      source:            'verify-payment'
    });

    if (confirmResult.outcome === 'conflict') {
      return res.status(409).json({
        error: 'Your slot hold had expired and this time was reserved by another patient. Your payment has been flagged for a full refund — we will contact you shortly.',
        conflict:          true,
        appointmentStatus: 'PAID_SLOT_CONFLICT'
      });
    }

    // 9. WhatsApp confirmation (fire-and-forget, non-critical)
    sendWhatsAppConfirmation({
      phone:        existingBooking.phone_number,
      patientName:  existingBooking.patient_name,
      date:         existingBooking.appointment_date || timestamp.split('T')[0],
      time:         existingBooking.appointment_time || '',
      meetingLink:  confirmResult.meetingLink,
      bookingId,
      packageName:  existingBooking.service_name || 'Doctor Consultation'
    });

    return res.status(200).json({
      success:              true,
      bookingId,
      paymentId,
      meetingLink:          confirmResult.meetingLink,
      calendarEventCreated: confirmResult.calendarEventCreated,
      appointmentStatus:    confirmResult.appointmentStatus,
      paymentsRecorded:     paySuccess,
      bookingUpdated:       confirmResult.bookingUpdated,
      message: confirmResult.calendarEventCreated
        ? 'Payment verified and appointment confirmed!'
        : 'Payment verified! Appointment saved (Calendar sync pending admin review).'
    });

  } catch (err) {
    console.error('[verify-payment] Unhandled error:', err.message || err);
    return res.status(500).json({ error: 'Failed to verify payment.' });
  }
};

/**
 * Sends a Telegram refund-required alert.
 */
async function _sendRefundAlert({ reason, bookingId, name, phone, amount, razorpay_payment_id, razorpay_order_id }) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId || token.includes('your_') || token.includes('temporary_') || chatId.includes('your_')) return;

  const text =
    `⚠️ <b>[ACTION REQUIRED: MANUAL REFUND]</b>\n` +
    `Payment attempted on a booking that cannot be confirmed!\n\n` +
    `Booking ID: ${escHtml(bookingId)}\n` +
    `Patient: ${escHtml(name || 'N/A')}\nPhone: ${escHtml(phone || 'N/A')}\n` +
    `Razorpay Payment ID: <code>${escHtml(razorpay_payment_id)}</code>\n` +
    `Razorpay Order ID: <code>${escHtml(razorpay_order_id || 'N/A')}</code>\n` +
    `Amount: \u20B9${amount}\nReason: ${escHtml(reason)}\n\n` +
    `<i>Please verify Razorpay dashboard and issue manual refund if payment was captured.</i>`;

  const data = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  const opts = {
    hostname: 'api.telegram.org', port: 443,
    path: `/bot${token}/sendMessage`, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  };
  await new Promise((resolve) => {
    const req = https.request(opts, () => resolve());
    req.on('error', (e) => { console.error('[verify-payment] Telegram refund alert error:', e.message); resolve(); });
    req.write(data);
    req.end();
  });
}
