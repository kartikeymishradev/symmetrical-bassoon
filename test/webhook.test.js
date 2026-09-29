const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');

// We test the Razorpay webhook verification logic in webhook-razorpay.js
describe('Razorpay Webhook Security Hardening (P1-5)', () => {
  let server;
  let handler;
  const PORT = 3002;

  before(() => {
    // Inject mock env var for testing webhook signature
    process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';

    handler = require('../api/webhook-razorpay');

    server = http.createServer((req, res) => {
      // Emulate Vercel's wrapper logic for handler
      const resWrapper = {
        status: (code) => {
          res.statusCode = code;
          return {
            json: (data) => {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(data));
            },
            end: () => res.end()
          };
        }
      };
      handler(req, resWrapper);
    });

    server.listen(PORT, '127.0.0.1');
  });

  after(() => {
    server.close();
  });

  const sendWebhook = (bodyStr, signatureHeader) => {
    return new Promise((resolve) => {
      const req = http.request(`http://127.0.0.1:${PORT}`, {
        method: 'POST',
        headers: {
          'x-razorpay-signature': signatureHeader,
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.write(bodyStr);
      req.end();
    });
  };

  test('rejects missing signature', async () => {
    const rawBody = JSON.stringify({ event: 'payment.captured' });
    const res = await sendWebhook(rawBody, '');
    assert.strictEqual(res.status, 400);
    assert.match(res.body, /Invalid webhook signature/);
  });

  test('rejects forged signature', async () => {
    const rawBody = JSON.stringify({ event: 'payment.captured' });
    const res = await sendWebhook(rawBody, 'forged_sig');
    assert.strictEqual(res.status, 400);
    assert.match(res.body, /Invalid webhook signature/);
  });

  test('accepts valid raw signature (even with extra spaces)', async () => {
    // This body contains non-standard spacing which JSON.stringify would destroy
    const rawBody = '{  "event" :  "payment.captured" , "payload": { "payment": { "entity": {} } }  }';
    const validSignature = crypto.createHmac('sha256', 'test_webhook_secret').update(rawBody).digest('hex');

    const res = await sendWebhook(rawBody, validSignature);
    // 200 OK means it passed signature and got to idempotency or next step
    assert.strictEqual(res.status, 200);
  });

  test('validates bodyParser is disabled in config', () => {
    // Inspect the exported config
    assert.strictEqual(handler.config.api.bodyParser, false);
  });
});
