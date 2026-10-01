const test = require('node:test');
const assert = require('node:assert');
const { sendBookingConfirmationEmail, escHtml } = require('../lib/email');

test('Email Service Unit Tests', async (t) => {
  const originalEnv = process.env;

  t.beforeEach(() => {
    // Reset env before each test
    process.env = { ...originalEnv };
  });

  t.afterEach(() => {
    // Restore env after each test
    process.env = originalEnv;
  });

  await t.test('graceful fail when SMTP_HOST is missing (returns email_unconfigured)', async () => {
    delete process.env.SMTP_HOST;
    const result = await sendBookingConfirmationEmail({
      to: 'test@example.com',
      bookingId: 'b1'
    });
    assert.deepEqual(result, { success: false, reason: 'email_unconfigured' });
  });

  await t.test('graceful fail when SMTP_HOST is placeholder', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'user';
    const result = await sendBookingConfirmationEmail({
      to: 'test@example.com',
      bookingId: 'b1'
    });
    assert.deepEqual(result, { success: false, reason: 'email_unconfigured' });
  });

  await t.test('graceful fail when no email is provided', async () => {
    process.env.SMTP_HOST = 'smtp.real.com';
    process.env.SMTP_USER = 'user';
    const result = await sendBookingConfirmationEmail({
      to: '',
      bookingId: 'b1'
    });
    assert.deepEqual(result, { success: false, reason: 'no_email_provided' });
  });

  await t.test('network error results in graceful fail, no throw', async () => {
    process.env.SMTP_HOST = 'localhost'; // Invalid / nothing listening
    process.env.SMTP_PORT = '9999';
    process.env.SMTP_USER = 'test';
    process.env.SMTP_PASS = 'pass';
    
    // We expect this to fail connecting, but the function must catch and return false
    const result = await sendBookingConfirmationEmail({
      to: 'patient@example.com',
      patientName: 'John Doe',
      bookingId: 'b1',
      packageName: 'Consultation',
      date: '2023-10-10',
      time: '10:00 AM'
    });
    assert.equal(result.success, false);
    assert.ok(result.error);
    // It should not throw!
  });

  await t.test('XSS HTML injection is properly escaped', () => {
    const xssPayload = '<script>alert("xss")</script>';
    const escaped = escHtml(xssPayload);
    assert.equal(escaped, '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');

    const payload2 = 'John & Jane "Doe" \'Smith\'';
    assert.equal(escHtml(payload2), 'John &amp; Jane &quot;Doe&quot; &#39;Smith&#39;');
  });
});
