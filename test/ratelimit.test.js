const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { checkRateLimit } = require('../lib/ratelimit');

describe('Rate Limiter Security Hardening (P1-3)', () => {

  test('namespaces limits by endpoint', () => {
    const req1 = { url: '/api/enquiry', headers: { 'x-real-ip': '1.1.1.1' } };
    const req2 = { url: '/api/support', headers: { 'x-real-ip': '1.1.1.1' } };

    // Consume limits on req1
    for (let i = 0; i < 5; i++) {
      checkRateLimit(req1, null, 5, 60000);
    }
    const res1 = checkRateLimit(req1, null, 5, 60000);
    assert.strictEqual(res1.limited, true);

    // req2 should be completely unaffected
    const res2 = checkRateLimit(req2, null, 5, 60000);
    assert.strictEqual(res2.limited, false);
  });

  test('extracts the last IP from x-forwarded-for to prevent spoofing', () => {
    const req = { url: '/api/test', headers: { 'x-forwarded-for': 'spoofed.ip, middle.ip, 192.168.1.1' } };
    const res = checkRateLimit(req, null, 10, 60000);
    assert.strictEqual(res.clientIp, '192.168.1.1');
  });

  test('prefers x-vercel-forwarded-for over x-forwarded-for', () => {
    const req = { 
      url: '/api/test', 
      headers: { 
        'x-vercel-forwarded-for': '203.0.113.1',
        'x-forwarded-for': '1.1.1.1, 2.2.2.2' 
      } 
    };
    const res = checkRateLimit(req, null, 10, 60000);
    assert.strictEqual(res.clientIp, '203.0.113.1');
  });

  test('prefers x-real-ip over x-forwarded-for', () => {
    const req = { 
      url: '/api/test', 
      headers: { 
        'x-real-ip': '203.0.113.2',
        'x-forwarded-for': '1.1.1.1, 2.2.2.2' 
      } 
    };
    const res = checkRateLimit(req, null, 10, 60000);
    assert.strictEqual(res.clientIp, '203.0.113.2');
  });

});
