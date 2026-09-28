/**
 * Serverless API Endpoint: REVA Health Razorpay Webhook Listener
 * Route: POST /api/webhook-razorpay
 *
 * Authoritative asynchronous webhook handler for Razorpay payment capture/failure events.
 * Guarantees Google Sheets payment records and booking status updates even if
 * patient closes browser window before checkout callback completes.
 *
 * payment.captured flow:
 *  1. Verify Razorpay webhook signature (RAZORPAY_WEBHOOK_SECRET).
 *  2. Idempotency guard: if payment already in Payments tab, return 200.
 *  3. Append payment record to 'Payments' tab.
 *  4. Delegate to lib/confirm-booking.js (shared with verify-payment):
 *     - Terminal-state guard (never overwrites CONFIRMED / PAID_SLOT_CONFLICT)
 *     - Slot conflict check → PAID_SLOT_CONFLICT + Telegram refund alert
 *     - Calendar event creation (skipped if event_id already set)
 *     - Bookings update + Telegram success alert
 *
 * payment.failed:
 *  - Update booking to PAYMENT_FAILED (only if not already in a terminal state).
 */

const { verifyWebhookSignature } = require('../lib/razorpay');
const { appendPayment, isPaymentRecorded, updateBookingPaymentStatus, getAllBookings } = require('../lib/sheets');
const { confirmBooking, TERMINAL_STATUSES } = require('../lib/confirm-booking');

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Read raw body stream for signature verification
    let rawBody = '';
    if (typeof req.body === 'string') {
      // Fallback for local testing via server.js where body might be pre-read
      rawBody = req.body;
    } else {
      for await (const chunk of req) {
        rawBody += chunk;
      }
    }
    
    const signature = req.headers['x-razorpay-signature'];

    // 1. Verify webhook signature
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(500).json({ error: 'Webhook not configured: RAZORPAY_WEBHOOK_SECRET missing.' });
    }

    const isValid = verifyWebhookSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid webhook signature.' });
    }

    let payload = {};
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON payload.' });
    }

    const event          = payload.event;
    const paymentEntity  = (payload.payload && payload.payload.payment && payload.payload.payment.entity) || {};

    const razorpayPaymentId = paymentEntity.id           || '';
    const razorpayOrderId   = paymentEntity.order_id     || '';
    const amount            = (paymentEntity.amount || 0) / 100;
    const currency          = paymentEntity.currency     || 'INR';
    const status            = paymentEntity.status       || 'captured';
    const method            = paymentEntity.method       || 'online';
    const bookingId         = (paymentEntity.notes && paymentEntity.notes.booking_id) || paymentEntity.receipt || '';
    const timestamp         = new Date().toISOString();

    // ── payment.captured ────────────────────────────────────────────────────
    if (event === 'payment.captured' && bookingId) {

      // 2. Idempotency guard
      const alreadyProcessed = await isPaymentRecorded(razorpayPaymentId, bookingId);
      if (alreadyProcessed) {
        console.log(`[webhook] Duplicate payment.captured for booking=${bookingId} — skipping.`);
        return res.status(200).json({ status: 'ok', idempotent: true });
      }

      // 3. Append payment record to 'Payments' tab
      const paymentId = `PAY-WH-${Date.now().toString(36).toUpperCase()}`;
      try {
        await appendPayment([
          paymentId,
          bookingId,
          razorpayPaymentId,
          razorpayOrderId,
          amount,
          currency,
          status,
          method,
          timestamp,
          event,
          timestamp
        ]);
      } catch (e) {
        console.error(`[webhook] Failed to append payment row for booking=${bookingId}:`, e.message);
        // Continue — confirmBooking is more important than the payment row
      }

      // 4. Delegate confirm logic (slot conflict, calendar, Bookings update, Telegram)
      // Read booking row for patient details — confirmBooking also re-reads but we
      // need name/phone/email here for the delegate call.
      let bookingRow = null;
      try {
        const { bookings } = await getAllBookings();
        bookingRow = (bookings || []).find(b => b.booking_id === bookingId);
      } catch (e) {
        console.warn(`[webhook] Could not read booking row for booking=${bookingId}:`, e.message);
      }

      const confirmResult = await confirmBooking({
        bookingId,
        razorpayPaymentId,
        razorpayOrderId,
        date:        bookingRow ? bookingRow.appointment_date : '',
        time:        bookingRow ? bookingRow.appointment_time : '',
        name:        bookingRow ? bookingRow.patient_name     : '',
        phone:       bookingRow ? bookingRow.phone_number     : '',
        email:       bookingRow ? bookingRow.email            : '',
        packageName: bookingRow ? bookingRow.service_name     : '',
        amount,
        source:      'webhook'
      });

      console.log(`[webhook] booking=${bookingId} outcome=${confirmResult.outcome} status=${confirmResult.appointmentStatus}`);

    // ── payment.failed ───────────────────────────────────────────────────────
    } else if (event === 'payment.failed' && bookingId) {
      // Only update to PAYMENT_FAILED if not already in a terminal state
      try {
        const { bookings } = await getAllBookings();
        const row = (bookings || []).find(b => b.booking_id === bookingId);
        if (!row || !TERMINAL_STATUSES.has(row.appointment_status)) {
          await updateBookingPaymentStatus(bookingId, 'PAYMENT_FAILED', razorpayPaymentId, razorpayOrderId, 'PAYMENT_FAILED');
          console.log(`[webhook] Processed ${event} for booking=${bookingId}`);
        } else {
          console.log(`[webhook] Skipping PAYMENT_FAILED update — booking=${bookingId} already in ${row.appointment_status}`);
        }
      } catch (e) {
        console.error(`[webhook] Error handling payment.failed for booking=${bookingId}:`, e.message);
      }
    }

    return res.status(200).json({ status: 'ok', event });

  } catch (err) {
    console.error('[webhook] Unhandled error:', err.message || err);
    return res.status(500).json({ error: 'Internal Webhook error' });
  }
};

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
