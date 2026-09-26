/**
 * REVA Health — Razorpay Payment Gateway Integration Layer (Test & Production Modes)
 *
 * Provides server-side Razorpay order creation and HMAC-SHA256 signature verification.
 * Uses native Node.js crypto and https modules. Credentials are NEVER exposed to client.
 */

const crypto = require('crypto');
const https = require('https');

function getRazorpayCredentials() {
  const keyId = (process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY || process.env.RAZOY_PAY_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET || process.env.RAZOY_PAY_API_SECRET || '').trim().replace(/^["']|["']$/g, '');
  return { keyId, keySecret };
}

/**
 * Creates a Razorpay Order via REST API.
 * Amount is passed in INR (converted to paise i.e. amount * 100).
 */
async function createRazorpayOrder({ amount, currency = 'INR', receipt, notes = {} }) {
  const { keyId, keySecret } = getRazorpayCredentials();

  // If credentials are unconfigured / placeholder, return a mock order ID for local test mode
  if (!keyId || !keySecret || keyId.includes('your_') || keyId.includes('dummy_')) {
    console.warn('Razorpay credentials missing/placeholder; returning local test order.');
    return {
      success: true,
      mode: 'test_mock',
      orderId: `order_mock_${Date.now()}`,
      keyId: keyId || 'rzp_test_mock_key',
      amount: Math.round((parseFloat(amount) || 400) * 100),
      currency: currency
    };
  }

  const amountInPaise = Math.round((parseFloat(amount) || 0) * 100);
  if (!amountInPaise || amountInPaise <= 0) {
    return { success: false, error: 'Invalid order amount.' };
  }

  const payload = JSON.stringify({
    amount: amountInPaise,
    currency: currency,
    receipt: receipt || `rec_${Date.now()}`,
    notes: notes
  });

  const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  const options = {
    hostname: 'api.razorpay.com',
    port: 443,
    path: '/v1/orders',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve({
              success: true,
              mode: 'live_razorpay',
              orderId: parsed.id,
              keyId: keyId,
              amount: parsed.amount,
              currency: parsed.currency
            });
          } else {
            console.error('Razorpay Order API error:', parsed);
            resolve({ success: false, error: parsed.error ? parsed.error.description : 'Failed to create Razorpay Order' });
          }
        } catch (e) {
          resolve({ success: false, error: 'Invalid response from Razorpay Order API' });
        }
      });
    });

    req.on('error', (err) => {
      console.error('Razorpay HTTPS request error:', err.message);
      resolve({ success: false, error: err.message });
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Verifies Razorpay payment signature server-side using HMAC-SHA256.
 */
function verifyPaymentSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  const { keySecret } = getRazorpayCredentials();

  if (!keySecret || keySecret.includes('your_') || keySecret.includes('dummy_')) {
    if (razorpay_order_id && razorpay_order_id.startsWith('order_mock_')) {
      return { isValid: true, mode: 'test_mock' };
    }
  }

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !keySecret) {
    return { isValid: false, reason: 'Missing required signature parameters or key secret.' };
  }

  const generatedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const isValid = generatedSignature === razorpay_signature;
  return { isValid, mode: 'live_razorpay' };
}

/**
 * Verifies Razorpay Webhook signature server-side using HMAC-SHA256.
 */
function verifyWebhookSignature(rawBody, webhookSignature, webhookSecretOverride) {
  const webhookSecret = (webhookSecretOverride || process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
  if (!webhookSecret || !webhookSignature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  return expectedSignature === webhookSignature;
}

module.exports = {
  getRazorpayCredentials,
  createRazorpayOrder,
  verifyPaymentSignature,
  verifyWebhookSignature
};
