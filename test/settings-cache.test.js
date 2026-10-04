const { test } = require('node:test');
const assert = require('node:assert');
const { getSettings, settingsCache } = require('../lib/sheets');
test('Settings Cache tests', async (t) => {
  await t.test('cache lifecycle check', async () => {
    settingsCache.data = { working_hours_start: '10:00' }; settingsCache.expiresAt = Date.now() + 60000;
    const res = await getSettings(); assert.strictEqual(res.success, true); assert.strictEqual(res.cached, true);
    settingsCache.data = null; settingsCache.expiresAt = 0;
    const res2 = await getSettings(); assert.strictEqual(res2.cached || false, false);
  });
});