const { test } = require('node:test');
const assert = require('node:assert');
const resendEmail = require('../api/admin/resend-email');
test('Resend Email API Security', async (t) => {
  process.env.ADMIN_SECRET_KEY = 'test_secret'; process.env.ADMIN_EMAIL = 'admin@revahealth.in';
  const mockReq = (headers, body) => ({ method: 'POST', headers: Object.assign({'x-forwarded-for': '127.0.0.1'}, headers), body });
  const mockRes = () => { const r = { statusCode: 200, data: null }; r.status = c => { r.statusCode = c; return r; }; r.json = d => { r.data = d; return r; }; r.end = () => r; r.setHeader = () => {}; return r; };
  await t.test('rejects missing or wrong secret', async () => {
    let r = mockRes(); await resendEmail(mockReq({}, {}), r); assert.strictEqual(r.statusCode, 401);
  });
  await t.test('rejects missing or wrong email', async () => {
    let r = mockRes(); await resendEmail(mockReq({'x-admin-secret': 'test_secret', 'x-admin-email': 'wrong@email.com'}, {}), r); assert.strictEqual(r.statusCode, 401);
  });
});