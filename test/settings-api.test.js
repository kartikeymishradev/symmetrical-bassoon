const { test } = require('node:test');
const assert = require('node:assert');
const settingsApi = require('../api/admin/settings');
test('Settings API Validation', async (t) => {
  process.env.ADMIN_SECRET_KEY = 'test_secret'; process.env.ADMIN_EMAIL = 'admin@revahealth.in';
  const req = body => ({ method: 'POST', headers: { 'x-admin-secret': 'test_secret', 'x-admin-email': 'admin@revahealth.in', 'x-forwarded-for': '127.0.0.1' }, body });
  const res = () => { const r = { statusCode: 200, data: null }; r.status = c => { r.statusCode = c; return r; }; r.json = d => { r.data = d; return r; }; r.end = () => r; r.setHeader = () => {}; return r; };
  await t.test('update_price rejects invalid price', async () => {
    let r = res(); await settingsApi(req({ action: 'update_price', serviceId: 's1', newPrice: -10 }), r); assert.strictEqual(r.statusCode, 400);
    r = res(); await settingsApi(req({ action: 'update_price', serviceId: 's1', newPrice: 150000 }), r); assert.strictEqual(r.statusCode, 400);
  });
  await t.test('update_settings rejects invalid times', async () => {
    let r = res(); await settingsApi(req({ action: 'update_settings', start_time: '25:00', end_time: '18:00', working_days: 'mon', lead_time_hours: 1 }), r); assert.strictEqual(r.statusCode, 400);
    r = res(); await settingsApi(req({ action: 'update_settings', start_time: '18:00', end_time: '09:00', working_days: 'mon', lead_time_hours: 1 }), r); assert.strictEqual(r.statusCode, 400);
  });
  await t.test('update_settings rejects invalid day', async () => {
    let r = res(); await settingsApi(req({ action: 'update_settings', start_time: '09:00', end_time: '18:00', working_days: 'mon,someday', lead_time_hours: 1 }), r); assert.strictEqual(r.statusCode, 400);
  });
});