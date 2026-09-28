/**
 * Serverless API Endpoint: REVA Health Verify Payment & Confirm Appointment
 * Route: POST /api/verify-payment
 *
 * 1. Validates required fields (bookingId, razorpay_payment_id).
 * 2. Guards against SLOT_CONFLICT_CANCELLED bookings (payment on cancelled slot → refund alert).
 * 3. Idempotency guard: if payment already recorded in Payments tab, return 200 immediately.
 * 4. Verifies Razorpay HMAC-SHA256 signature server-side.
 * 5. Appends transaction record to 'Payments' tab (11 columns A:K, RAW).
 * 6. Delegates all remaining work to lib/confirm-booking.js:
 *    - Terminal-state guard (never overwrites CONFIRMED / PAID_SLOT_CONFLICT / etc.)
 *    - Slot conflict check (returns 409 + Telegram refund alert if taken)
 *    - Google Calendar event creation (skipped if event already exists)
 *    - Bookings tab update + Telegram success alert
 * 7. Invokes WhatsApp confirmation hook.
 */

const https = require('https');
const { verifyPaymentSignature } = require('../lib/razorpay');
const { appendPayment, updateBookingPaymentStatus, isPaymentRecorded, getAllBookings } = require('../lib/sheets');
const { sendWhatsAppConfirmation } = require('../lib/whatsapp');
const { checkRateLimit } = require('../lib/ratelimit');
const { setCorsHeaders } = require('../lib/cors');
const { confirmBooking } = require('../lib/confirm-booking');

module.exports = async function handler(req, res) {
  // Dynamic CORS Headers
  setCorsHeaders(req, res, { methods: 'POST, OPTIONS' });

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Rate Limiting (10 requests per minute per IP)
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

    if (!bookingId || !razorpay_payment_id) {
      return res.status(400).json({ error: 'Booking ID and Payment ID are required.' });
    }

    // 1. Read booking row (needed for slot-conflict-cancelled guard and authoritative amount)
    let existingBooking = null;
    try {
      const { bookings } = await getAllBookings();
      existingBooking = (bookings || []).find(b => b.booking_id === bookingId);
    } catch (e) {
      console.warn('[verify-payment] Could not read existing booking:', e.message);
    }

    // 2. Guard: booking was pre-cancelled at create-order time due to a race condition
    if (existingBooking && existingBooking.appointment_status === 'SLOT_CONFLICT_CANCELLED') {
      // Payment arrived on an already-cancelled booking slot — flag for refund
      await _sendRefundAlert({
        reason: 'SLOT_CONFLICT_CANCELLED',
        bookingId,
        name: name || existingBooking.patient_name,
        phone: phone || existingBooking.phone_number,
        amount: amount || existingBooking.amount || 400,
        razorpay_payment_id,
        razorpay_order_id
      });
      return res.status(409).json({
        error: 'This booking slot was already reserved by another patient. Please contact support for a refund if payment was captured.'
      });
    }

    // 3. Idempotency Guard (payment already fully recorded in Payments tab)
    const alreadyProcessed = await isPaymentRecorded(razorpay_payment_id, bookingId);
    if (alreadyProcessed) {
      return res.status(200).json({
        success: true,
        idempotent: true,
        bookingId,
        message: 'Payment already processed and recorded previously.'
      });
    }

    // 4. Verify HMAC-SHA256 Signature
    const sigCheck = verifyPaymentSignature({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    });
    if (!sigCheck.isValid) {
      return res.status(400).json({ error: 'Invalid payment signature. Payment verification failed.' });
    }

    const timestamp = new Date().toISOString();

    // 5. Append Transaction to 'Payments' tab (11 columns A:K, RAW)
    // Use authoritative amount from Bookings row — never trust client input
    const authoritativeAmount = (existingBooking && existingBooking.amount && !isNaN(parseFloat(existingBooking.amount)))
      ? parseFloat(existingBooking.amount)
      : 400;

    const paymentId = `PAY-${Date.now().toString(36).toUpperCase()}`;
    const paymentRow = [
      paymentId,
      bookingId,
      razorpay_payment_id,
      razorpay_order_id || '',
      authoritativeAmount,
      'INR',
      'captured',
      'online',
      timestamp,
      'payment.verify',
      timestamp
    ];

    let paySuccess = false;
    try {
      const payRes = await appendPayment(paymentRow);
      paySuccess = payRes.success;
    } catch (payErr) {
      console.error('[verify-payment] Error appending payment to Sheets:', payErr.message);
    }

    // 6. Delegate: slot conflict check, calendar creation, Bookings update, Telegram alert
    const confirmResult = await confirmBooking({
      bookingId,
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId:   razorpay_order_id || '',
      date,
      time,
      name,
      phone,
      email,
      packageName: pkg,
      amount:      authoritativeAmount,
      calendarIdOverride,
      source:      'verify-payment'
    });

    if (confirmResult.outcome === 'conflict') {
      return res.status(409).json({
        error: 'Your slot hold had expired and this time was reserved by another patient. Your payment has been flagged for a full refund — we will contact you shortly.',
        conflict: true,
        appointmentStatus: 'PAID_SLOT_CONFLICT'
      });
    }

    // 7. WhatsApp confirmation hook (fire-and-forget — non-critical)
    sendWhatsAppConfirmation({
      phone,
      patientName:  name,
      date:         date || timestamp.split('T')[0],
      time:         time || '',
      meetingLink:  confirmResult.meetingLink,
      bookingId,
      packageName:  pkg
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
 * Sends a Telegram refund-required alert. Used only for SLOT_CONFLICT_CANCELLED guard.
 */
async function _sendRefundAlert({ reason, bookingId, name, phone, amount, razorpay_payment_id, razorpay_order_id }) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId || token.includes('your_') || token.includes('temporary_') || chatId.includes('your_')) return;

  const text = `⚠️ <b>[ACTION REQUIRED: MANUAL REFUND]</b>\n` +
    `Payment attempted on CANCELLED booking slot!\n\n` +
    `Booking ID: ${bookingId}\n` +
    `Patient: ${name || 'N/A'}\nPhone: ${phone || 'N/A'}\n` +
    `Razorpay Payment ID: <code>${razorpay_payment_id}</code>\n` +
    `Razorpay Order ID: <code>${razorpay_order_id || 'N/A'}</code>\n` +
    `Amount: \u20B9${amount}\nReason: ${reason}\n\n` +
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
