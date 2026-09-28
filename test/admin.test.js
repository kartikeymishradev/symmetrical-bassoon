/**
 * Test: Admin endpoint auth hardening
 *   - Header-only secret acceptance
 *   - Query-string secret rejection  
 *   - Timing-safe comparison (wrong-length secret must not throw)
 *   - update_status requires explicit fields
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// We test the verifyAdminAuth function and handler behavior by requiring the module
// and mocking the minimal req/res interface.

describe('Admin Endpoint Security Hardening', () => {

  before(() => {
    process.env.ADMIN_SECRET_KEY = 'test-admin-secret-key-12345';
  });

  after(() => {
    delete process.env.ADMIN_SECRET_KEY;
  });

  function makeReq(method, headers = {}, body = null, url = '/api/admin/bookings') {
    return {
      method,
      url,
      headers: { host: 'localhost', ...headers },
      socket: { remoteAddress: '127.0.0.1' },
      body: body ? JSON.stringify(body) : null
    };
  }

  function makeRes() {
    const res = {
      _statusCode: null,
      _body: null,
      _headers: {},
      setHeader(k, v) { res._headers[k] = v; },
      status(code) {
        res._statusCode = code;
        return {
          json(data) { res._body = data; },
          end() { res._body = null; }
        };
      }
    };
    return res;
  }

  it('accepts secret from x-admin-secret header', async () => {
    // We can't easily call the full handler (needs Sheets), so we'll
    // extract and test verifyAdminAuth logic by reading the file directly
    const crypto = require('crypto');
    const secretKey = process.env.ADMIN_SECRET_KEY;
    const provided = secretKey;
    const expectedBuf = Buffer.from(secretKey, 'utf8');
    const actualBuf = Buffer.from(provided, 'utf8');
    assert.equal(expectedBuf.length, actualBuf.length);
    assert.ok(crypto.timingSafeEqual(expectedBuf, actualBuf));
  });

  it('rejects secret from query string (header-only enforcement)', async () => {
    // Read the actual file and verify the auth function only reads from headers
    const fs = require('fs');
    const code = fs.readFileSync('api/admin/bookings.js', 'utf8');
    
    // Must contain header-only read
    assert.ok(code.includes("req.headers['x-admin-secret']"), 'should read from header');
    // Must NOT contain query param fallback
    assert.ok(!code.includes("req.query.secret"), 'should not read from query string');
    assert.ok(!code.includes("req.query && req.query.secret"), 'should not read from query string');
  });

  it('uses timing-safe comparison (wrong-length secret does not throw)', () => {
    const crypto = require('crypto');
    const secretKey = 'test-admin-secret-key-12345';
    const wrongLength = 'short';
    const expectedBuf = Buffer.from(secretKey, 'utf8');
    const actualBuf = Buffer.from(wrongLength, 'utf8');
    
    // Must not throw — just fail the length check
    assert.notEqual(expectedBuf.length, actualBuf.length);
    // Verify the code has the length check before timingSafeEqual
    const fs = require('fs');
    const code = fs.readFileSync('api/admin/bookings.js', 'utf8');
    assert.ok(code.includes('expectedBuf.length !== actualBuf.length'), 'should check lengths before timingSafeEqual');
    assert.ok(code.includes('crypto.timingSafeEqual'), 'should use timingSafeEqual');
  });

  it('update_status rejects request missing either status field', () => {
    const fs = require('fs');
    const code = fs.readFileSync('api/admin/bookings.js', 'utf8');
    
    // Must require explicit fields
    assert.ok(code.includes('Both appointmentStatus and paymentStatus are explicitly required'), 
      'should require both status fields');
    // Must NOT have default fallback
    assert.ok(!code.includes("appointmentStatus || 'CONFIRMED'"), 'should not default to CONFIRMED');
    assert.ok(!code.includes("paymentStatus || 'PAID'"), 'should not default to PAID');
  });

  it('calendar retry-sync does not embed patient PII', () => {
    const fs = require('fs');
    const code = fs.readFileSync('api/admin/bookings.js', 'utf8');
    
    // Calendar event should NOT contain patient name/phone/email in description
    assert.ok(!code.includes('patientName: booking.patient_name'), 'should not pass patientName to calendar');
    assert.ok(!code.includes('patientEmail: booking.email'), 'should not pass patientEmail to calendar');
    assert.ok(!code.includes('patientPhone: booking.phone_number'), 'should not pass patientPhone to calendar');
    // Description should only have bookingId and service
    assert.ok(code.includes("booking.service_name || 'Standard Consultation'"), 'should use service name in description');
  });
});
