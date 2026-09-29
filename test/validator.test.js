const { test, describe } = require('node:test');
const assert = require('node:assert');
const validator = require('../lib/validator');

describe('Input Validation Security Hardening (P1-7)', () => {
  test('isValidPhone strictly allows 10 digits or +91 prefix', () => {
    assert.strictEqual(validator.isValidPhone('9876543210'), true);
    assert.strictEqual(validator.isValidPhone('+919876543210'), true);
    assert.strictEqual(validator.isValidPhone('+91 98765 43210'), true); // spacing stripped
    assert.strictEqual(validator.isValidPhone('987-654-3210'), true);
    
    assert.strictEqual(validator.isValidPhone('123'), false);
    assert.strictEqual(validator.isValidPhone('+19876543210'), false);
    assert.strictEqual(validator.isValidPhone('abcdefghij'), false);
    assert.strictEqual(validator.isValidPhone(null), false);
  });

  test('isValidEmail accepts basic formats and rejects oversized/invalid', () => {
    assert.strictEqual(validator.isValidEmail('test@example.com'), true);
    assert.strictEqual(validator.isValidEmail(''), true); // optional
    assert.strictEqual(validator.isValidEmail(null), true);
    
    assert.strictEqual(validator.isValidEmail('not-an-email'), false);
    assert.strictEqual(validator.isValidEmail('test@example'), false);
    assert.strictEqual(validator.isValidEmail('a'.repeat(300) + '@example.com'), false);
  });

  test('isValidName prevents long payloads and weird characters', () => {
    assert.strictEqual(validator.isValidName('John Doe'), true);
    assert.strictEqual(validator.isValidName('Jane O\'Connor'), true);
    assert.strictEqual(validator.isValidName('Mary-Jane'), true);
    
    assert.strictEqual(validator.isValidName(''), false);
    assert.strictEqual(validator.isValidName('a'.repeat(101)), false);
    assert.strictEqual(validator.isValidName('<script>alert(1)</script>'), false);
  });

  test('isValidDate strictly requires YYYY-MM-DD and falls in 60 day window', () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;

    assert.strictEqual(validator.isValidDate(todayStr), true);
    
    // Past date should fail
    assert.strictEqual(validator.isValidDate('2000-01-01'), false);
    
    // Future date > 60 days should fail
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 100);
    const fy = farFuture.getFullYear();
    const fm = String(farFuture.getMonth() + 1).padStart(2, '0');
    const fd = String(farFuture.getDate()).padStart(2, '0');
    assert.strictEqual(validator.isValidDate(`${fy}-${fm}-${fd}`), false);

    // Malformed format
    assert.strictEqual(validator.isValidDate('01/01/2026'), false);
    assert.strictEqual(validator.isValidDate('2026-1-1'), false);
  });

  test('isValidTime strictly allows 24h or 12h formats', () => {
    assert.strictEqual(validator.isValidTime('14:30'), true);
    assert.strictEqual(validator.isValidTime('09:00'), true);
    assert.strictEqual(validator.isValidTime('2:30 PM'), true);
    assert.strictEqual(validator.isValidTime('11:00 AM'), true);

    assert.strictEqual(validator.isValidTime('25:00'), false);
    assert.strictEqual(validator.isValidTime('14:60'), false);
    assert.strictEqual(validator.isValidTime('12:30 PMX'), false);
    assert.strictEqual(validator.isValidTime('1430'), false);
  });

  test('isValidText enforces max lengths', () => {
    assert.strictEqual(validator.isValidText('Normal text', 100), true);
    assert.strictEqual(validator.isValidText(null, 100), true); // optional
    assert.strictEqual(validator.isValidText('a'.repeat(101), 100), false);
  });
});
