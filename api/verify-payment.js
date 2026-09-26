/**
 * Serverless API Endpoint: REVA Health Verify Payment & Confirm Appointment
 * Route: POST /api/verify-payment
 *
 * 1. Idempotency Guard: Checks if payment/booking is already processed to prevent duplicates.
 * 2. Verifies Razorpay HMAC-SHA256 signature server-side.
 * 3. Appends transaction record to 'Payments' tab (11 columns A:K, RAW).
 * 4. Updates 'Bookings' tab row: payment_status = 'PAID', razorpay_payment_id.
 * 5. Attempts Google Calendar Event creation with optional Google Meet link.
 *    - If Calendar sync succeeds: appointment_status = 'CONFIRMED'.
 *    - If Calendar sync fails: appointment_status = 'CONFIRMATION_PENDING' (Booking is NEVER lost; Admin can 1-click retry sync).
 * 6. Dispatches Telegram Admin Alert with payment confirmation & meeting details.
 * 7. Invokes WhatsApp confirmation hook.
 */

const https = require('https');
const { verifyPaymentSignature } = require('../lib/razorpay');
const { createAppointmentEvent } = require('../lib/calendar');
const { appendPayment, updateBookingPaymentStatus, updateBookingCalendarDetails, updateBookingTelegramStatus, isPaymentRecorded } = require('../lib/sheets');
const { sendWhatsAppConfirmation } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
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

    // 1. Idempotency Check (Prevent duplicate payments or duplicate calendar events)
    const alreadyProcessed = await isPaymentRecorded(razorpay_payment_id, bookingId);
    if (alreadyProcessed) {
      return res.status(200).json({
        success: true,
        idempotent: true,
        bookingId: bookingId,
        message: 'Payment already processed and recorded previously.'
      });
    }

    // 2. Verify HMAC-SHA256 Signature
    const sigCheck = verifyPaymentSignature({
      razorpay_order_id: razorpay_order_id,
      razorpay_payment_id: razorpay_payment_id,
      razorpay_signature: razorpay_signature
    });

    if (!sigCheck.isValid) {
      return res.status(400).json({ error: 'Invalid payment signature. Payment verification failed.' });
    }

    const timestamp = new Date().toISOString();
    const cleanDate = date || timestamp.split('T')[0];
    const cleanTime = time || '10:00 AM';

    // Parse start ISO for Calendar event
    let startIso = `${cleanDate}T10:00:00+05:30`;
    let endIso = `${cleanDate}T10:30:00+05:30`;
    if (time && time.includes(':')) {
      const match = time.match(/(\d+):(\d+)\s*(AM|PM)?/i);
      if (match) {
        let h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const ampm = match[3] ? match[3].toUpperCase() : '';
        if (ampm === 'PM' && h < 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        const hStr = String(h).padStart(2, '0');
        const mStr = String(m).padStart(2, '0');
        startIso = `${cleanDate}T${hStr}:${mStr}:00+05:30`;
        const endH = h + Math.floor((m + 30) / 60);
        const endM = (m + 30) % 60;
        endIso = `${cleanDate}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00+05:30`;
      }
    }

    // 3. Append Transaction to 'Payments' tab (11 columns A:K, RAW)
    const paymentId = `PAY-${Date.now().toString(36).toUpperCase()}`;
    const paymentRow = [
      paymentId,
      bookingId,
      razorpay_payment_id,
      razorpay_order_id || '',
      amount || 400,
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
      console.error('Error appending payment to Sheets:', payErr.message);
    }

    // 4. Create Google Calendar Event (AFTER payment verified)
    let calRes = { success: false, meetingLink: '', eventId: '' };
    try {
      calRes = await createAppointmentEvent({
        calendarIdOverride: calendarIdOverride,
        summary: `REVA Health Consultation: ${name || 'Patient'}`,
        description: `Confirmed Medical Consultation\nBooking ID: ${bookingId}\nPatient: ${name}\nPhone: ${phone}\nEmail: ${email}`,
        startIso: startIso,
        endIso: endIso,
        patientName: name,
        patientEmail: email,
        patientPhone: phone,
        bookingId: bookingId
      });
    } catch (calErr) {
      console.error('Error creating Google Calendar event:', calErr.message);
    }

    // Determine final appointment_status (CONFIRMED vs CONFIRMATION_PENDING recovery state)
    const finalApptStatus = calRes.success ? 'CONFIRMED' : 'CONFIRMATION_PENDING';

    // 5. Update 'Bookings' tab (payment_status = 'PAID', appointment_status = finalApptStatus)
    let bookingUpdateSuccess = false;
    try {
      const updateRes = await updateBookingPaymentStatus(bookingId, 'PAID', razorpay_payment_id, razorpay_order_id, finalApptStatus);
      bookingUpdateSuccess = updateRes.success;
      if (calRes.success && calRes.eventId) {
        await updateBookingCalendarDetails(bookingId, calRes.eventId, finalApptStatus);
      }
    } catch (upErr) {
      console.error('Error updating booking status:', upErr.message);
    }

    // 6. Dispatch Telegram Admin Alert
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    const isPlaceholder = !token || !chatId || token.includes('your_') || token.includes('temporary_') || chatId.includes('your_');

    if (!isPlaceholder) {
      const calStatusTag = calRes.success ? 'CONFIRMED' : '[ACTION REQUIRED] CONFIRMATION_PENDING (Calendar Sync Failed)';
      const messageText = `REVA HEALTH PAYMENT RECEIVED (${bookingId})\n\n` +
        `Patient: ${name || 'N/A'}\n` +
        `Phone: ${phone || 'N/A'}\n` +
        `Package: ${pkg || 'Doctor Consultation'}\n` +
        `Amount Paid: ₹${amount || 400}\n` +
        `Payment ID: ${razorpay_payment_id}\n` +
        `Date & Time: ${cleanDate} at ${cleanTime}\n` +
        `Google Meet Link: ${calRes.meetingLink || 'Scheduled / Sync Pending'}\n\n` +
        `Status: ${calStatusTag}`;

      const telegramData = JSON.stringify({
        chat_id: chatId,
        text: messageText,
        parse_mode: 'HTML'
      });

      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(telegramData)
        }
      };

      const tgReq = https.request(options, (tgRes) => {
        if (tgRes.statusCode === 200) {
          updateBookingTelegramStatus(bookingId, 'SENT');
        }
      });
      tgReq.on('error', (e) => console.error('Telegram verify notification error:', e.message));
      tgReq.write(telegramData);
      tgReq.end();
    }

    // 7. Invoke WhatsApp confirmation hook
    sendWhatsAppConfirmation({
      phone: phone,
      patientName: name,
      date: cleanDate,
      time: cleanTime,
      meetingLink: calRes.meetingLink,
      bookingId: bookingId,
      packageName: pkg
    });

    return res.status(200).json({
      success: true,
      bookingId: bookingId,
      paymentId: paymentId,
      meetingLink: calRes.meetingLink || '',
      calendarEventCreated: calRes.success,
      appointmentStatus: finalApptStatus,
      paymentsRecorded: paySuccess,
      bookingUpdated: bookingUpdateSuccess,
      message: calRes.success
        ? 'Payment verified and appointment confirmed!'
        : 'Payment verified! Appointment saved (Calendar sync pending admin review).'
    });

  } catch (err) {
    console.error('Error in /api/verify-payment handler:', err.message || err);
    return res.status(500).json({ error: 'Failed to verify payment.' });
  }
};
