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
const { appendPayment, updateBookingPaymentStatus, updateBookingCalendarDetails, updateBookingTelegramStatus, isPaymentRecorded, getAllBookings } = require('../lib/sheets');
const { sendWhatsAppConfirmation } = require('../lib/whatsapp');
const { checkRateLimit } = require('../lib/ratelimit');
const { setCorsHeaders } = require('../lib/cors');

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

    // 1. Check if booking was cancelled due to slot conflict
    let existingBooking = null;
    try {
      const { bookings } = await getAllBookings();
      existingBooking = (bookings || []).find(b => b.booking_id === bookingId);
      if (existingBooking && existingBooking.appointment_status === 'SLOT_CONFLICT_CANCELLED') {
        // Send Telegram admin alert for manual refund processing if payment ID is present
        if (razorpay_payment_id) {
          const token = process.env.TELEGRAM_BOT_TOKEN;
          const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
          const isPlaceholder = !token || !chatId || token.includes('your_') || token.includes('temporary_') || chatId.includes('your_');

          if (!isPlaceholder) {
            const messageText = `⚠️ <b>[ACTION REQUIRED: MANUAL REFUND]</b>\n` +
              `Payment attempted on CANCELLED booking slot!\n\n` +
              `Booking ID: ${bookingId}\n` +
              `Patient: ${name || existingBooking.patient_name || 'N/A'}\n` +
              `Phone: ${phone || existingBooking.phone_number || 'N/A'}\n` +
              `Razorpay Payment ID: <code>${razorpay_payment_id}</code>\n` +
              `Razorpay Order ID: <code>${razorpay_order_id || 'N/A'}</code>\n` +
              `Amount: ₹${amount || existingBooking.amount || 400}\n` +
              `Reason: SLOT_CONFLICT_CANCELLED\n\n` +
              `<i>Please verify Razorpay dashboard and issue manual refund if payment was captured.</i>`;

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

            await new Promise((resolve) => {
              const tgReq = https.request(options, () => resolve());
              tgReq.on('error', (e) => {
                console.error('Telegram refund alert error:', e.message);
                resolve();
              });
              tgReq.write(telegramData);
              tgReq.end();
            });
          }
        }

        return res.status(409).json({
          error: 'This booking slot was already reserved by another patient. Please contact support for a refund if payment was captured.'
        });
      }
    } catch (checkCancelErr) {
      console.warn('Error checking cancelled booking status:', checkCancelErr.message);
    }

    // 2. Idempotency Check (Prevent duplicate payments or duplicate calendar events)
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
    // Use authoritative amount from Bookings sheet record created during create-order (never trust client input)
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
      console.error('Error appending payment to Sheets:', payErr.message);
    }

    // 4. Pre-Calendar Slot Conflict Check (Bug 2 fix)
    // Before creating the calendar event, verify the slot hasn't been confirmed by another booking
    // while this patient's hold was expired and they were still in the payment flow.
    let lateConflict = false;
    try {
      const { client: sheetsClient2, sheetId: sheetId2 } = getSheetsClient();
      if (sheetsClient2 && sheetId2 && cleanDate && cleanTime) {
        const slotCheckRes = await sheetsClient2.spreadsheets.values.get({
          spreadsheetId: sheetId2,
          range: 'Bookings!A:Q'
        });
        const slotRows = slotCheckRes.data.values || [];
        for (let i = 1; i < slotRows.length; i++) {
          const r = slotRows[i];
          if (r[0] === bookingId) continue; // Skip own row
          if (r[10] === cleanDate && r[11] === cleanTime && r[12] === 'CONFIRMED') {
            lateConflict = true;
            break;
          }
        }
      }
    } catch (conflictCheckErr) {
      console.warn('[verify-payment] Pre-calendar conflict check failed (continuing):', conflictCheckErr.message);
    }

    if (lateConflict) {
      // Mark booking as PAID_SLOT_CONFLICT so admin can see it needs a refund
      try {
        await updateBookingPaymentStatus(bookingId, 'PAID', razorpay_payment_id, razorpay_order_id || '', 'PAID_SLOT_CONFLICT');
      } catch (updateErr) {
        console.error('[verify-payment] Failed to update PAID_SLOT_CONFLICT status:', updateErr.message);
      }

      // Send Telegram refund alert
      const tokenLC = process.env.TELEGRAM_BOT_TOKEN;
      const chatIdLC = process.env.TELEGRAM_ADMIN_CHAT_ID;
      const isPlaceholderLC = !tokenLC || !chatIdLC || tokenLC.includes('your_') || tokenLC.includes('temporary_') || chatIdLC.includes('your_');
      if (!isPlaceholderLC) {
        const alertMsg = `⚠️ <b>[ACTION REQUIRED: SLOT CONFLICT REFUND]</b>\n` +
          `Payment received AFTER hold expired — slot was taken by another patient!\n\n` +
          `Booking ID: ${bookingId}\n` +
          `Patient: ${name || 'N/A'}\n` +
          `Phone: ${phone || 'N/A'}\n` +
          `Date & Time: ${cleanDate} at ${cleanTime}\n` +
          `Razorpay Payment ID: <code>${razorpay_payment_id}</code>\n` +
          `Amount: ₹${amount || authoritativeAmount}\n` +
          `Status: PAID_SLOT_CONFLICT\n\n` +
          `<i>Please verify Razorpay dashboard and issue manual refund if payment was captured.</i>`;
        const alertData = JSON.stringify({ chat_id: chatIdLC, text: alertMsg, parse_mode: 'HTML' });
        const alertOptions = {
          hostname: 'api.telegram.org', port: 443,
          path: `/bot${tokenLC}/sendMessage`, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(alertData) }
        };
        await new Promise((resolve) => {
          const tgReq = https.request(alertOptions, () => resolve());
          tgReq.on('error', (e) => { console.error('Telegram PAID_SLOT_CONFLICT alert error:', e.message); resolve(); });
          tgReq.write(alertData);
          tgReq.end();
        });
      }

      return res.status(409).json({
        error: 'Your slot hold had expired and this time was reserved by another patient. Your payment has been flagged for a full refund — we will contact you shortly.',
        conflict: true,
        appointmentStatus: 'PAID_SLOT_CONFLICT'
      });
    }

    // 5. Create Google Calendar Event (AFTER payment verified & conflict cleared)
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

    // 6. Update 'Bookings' tab (payment_status = 'PAID', appointment_status = finalApptStatus)
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

      await new Promise((resolve) => {
        const tgReq = https.request(options, (tgRes) => {
          if (tgRes.statusCode === 200) {
            updateBookingTelegramStatus(bookingId, 'SENT')
              .then(() => resolve())
              .catch(() => resolve());
          } else {
            resolve();
          }
        });
        tgReq.on('error', (e) => {
          console.error('Telegram verify notification error:', e.message);
          resolve();
        });
        tgReq.write(telegramData);
        tgReq.end();
      });
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

