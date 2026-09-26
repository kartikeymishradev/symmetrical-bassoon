/**
 * Serverless API Endpoint: REVA Health Razorpay Webhook Listener
 * Route: POST /api/webhook-razorpay
 *
 * Authoritative asynchronous webhook handler for Razorpay payment capture/failure events.
 * Guarantees Google Sheets payment records and booking status updates even if
 * patient closes browser window before checkout callback completes.
 */

const { verifyWebhookSignature } = require('../lib/razorpay');
const { appendPayment, updateBookingPaymentStatus, isPaymentRecorded } = require('../lib/sheets');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const signature = req.headers['x-razorpay-signature'];

    // Verify webhook signature (RAZORPAY_WEBHOOK_SECRET mandatory)
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(500).json({ error: 'Webhook not configured: RAZORPAY_WEBHOOK_SECRET environment variable is missing.' });
    }

    const isValid = verifyWebhookSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid webhook signature.' });
    }

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const event = payload.event;
    const paymentEntity = (payload.payload && payload.payload.payment && payload.payload.payment.entity) || {};

    const razorpayPaymentId = paymentEntity.id || '';
    const razorpayOrderId = paymentEntity.order_id || '';
    const amount = (paymentEntity.amount || 0) / 100;
    const currency = paymentEntity.currency || 'INR';
    const status = paymentEntity.status || 'captured';
    const method = paymentEntity.method || 'online';
    const bookingId = (paymentEntity.notes && paymentEntity.notes.booking_id) || paymentEntity.receipt || '';
    const timestamp = new Date().toISOString();

    if (event === 'payment.captured' && bookingId) {
      // Idempotency check: Ignore duplicate webhooks
      const alreadyProcessed = await isPaymentRecorded(razorpayPaymentId, bookingId);
      if (alreadyProcessed) {
        return res.status(200).json({ status: 'ok', idempotent: true });
      }

      // Append transaction record to 'Payments' tab
      const paymentId = `PAY-WH-${Date.now().toString(36).toUpperCase()}`;
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

      // Update 'Bookings' tab status to PAID
      await updateBookingPaymentStatus(bookingId, 'PAID', razorpayPaymentId, razorpayOrderId, 'CONFIRMED');

      console.log(`[RAZORPAY_WEBHOOK] Successfully processed ${event} for Booking ID ${bookingId}`);
    } else if (event === 'payment.failed' && bookingId) {
      // Handle payment failure event -> update Bookings status to PAYMENT_FAILED
      await updateBookingPaymentStatus(bookingId, 'PAYMENT_FAILED', razorpayPaymentId, razorpayOrderId, 'PAYMENT_FAILED');
      console.log(`[RAZORPAY_WEBHOOK] Processed ${event} for Booking ID ${bookingId}`);
    }

    return res.status(200).json({ status: 'ok', event: event });

  } catch (err) {
    console.error('Error handling Razorpay Webhook:', err.message || err);
    return res.status(500).json({ error: 'Internal Webhook error' });
  }
};
