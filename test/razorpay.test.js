const { test, describe } = require('node:test');
const assert = require('node:assert');
const { createRazorpayOrder, verifyPaymentSignature, getRazorpayCredentials } = require('../lib/razorpay');

describe('Razorpay Security Hardening', () => {
  test('createRazorpayOrder fails closed when credentials missing and mock not explicitly allowed', async () => {
    process.env.RAZORPAY_KEY_ID = 'your_key';
    process.env.RAZORPAY_KEY_SECRET = 'your_secret';
    process.env.ALLOW_MOCK_PAYMENTS = 'false';
    
    const result = await createRazorpayOrder({ amount: 100 });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'Payment gateway not configured.');
  });

  test('createRazorpayOrder returns mock when explicitly allowed', async () => {
    process.env.RAZORPAY_KEY_ID = 'your_key';
    process.env.RAZORPAY_KEY_SECRET = 'your_secret';
    process.env.ALLOW_MOCK_PAYMENTS = 'true';
    process.env.NODE_ENV = 'development';
    
    const result = await createRazorpayOrder({ amount: 100 });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.mode, 'test_mock');
    assert.ok(result.orderId.startsWith('order_mock_'));
  });

  test('verifyPaymentSignature fails closed when credentials missing and mock not explicitly allowed', () => {
    process.env.RAZORPAY_KEY_ID = 'your_key';
    process.env.RAZORPAY_KEY_SECRET = 'your_secret';
    process.env.ALLOW_MOCK_PAYMENTS = 'false';
    
    const result = verifyPaymentSignature({ 
      razorpay_order_id: 'order_mock_123', 
      razorpay_payment_id: 'pay_123', 
      razorpay_signature: 'sig' 
    });
    assert.strictEqual(result.isValid, false);
    assert.strictEqual(result.reason, 'Payment gateway not configured.');
  });

  test('verifyPaymentSignature returns valid for mock when explicitly allowed', () => {
    process.env.RAZORPAY_KEY_ID = 'your_key';
    process.env.RAZORPAY_KEY_SECRET = 'your_secret';
    process.env.ALLOW_MOCK_PAYMENTS = 'true';
    process.env.NODE_ENV = 'development';
    
    const result = verifyPaymentSignature({ 
      razorpay_order_id: 'order_mock_123', 
      razorpay_payment_id: 'pay_123', 
      razorpay_signature: 'sig' 
    });
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.mode, 'test_mock');
  });

  test('verifyPaymentSignature fails mock when explicitly allowed but NODE_ENV is production', () => {
    process.env.RAZORPAY_KEY_ID = 'your_key';
    process.env.RAZORPAY_KEY_SECRET = 'your_secret';
    process.env.ALLOW_MOCK_PAYMENTS = 'true';
    process.env.NODE_ENV = 'production';
    
    const result = verifyPaymentSignature({ 
      razorpay_order_id: 'order_mock_123', 
      razorpay_payment_id: 'pay_123', 
      razorpay_signature: 'sig' 
    });
    assert.strictEqual(result.isValid, false);
    assert.strictEqual(result.reason, 'Payment gateway not configured.');
  });
});
