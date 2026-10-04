const { test } = require('node:test');
const assert = require('node:assert');
const { generateStandardDaySlots } = require('../lib/calendar');
test('Calendar Async Check', async (t) => {
  await t.test('generateStandardDaySlots returns a promise', async () => {
    const p = generateStandardDaySlots('2026-10-15', 30, []);
    assert.strictEqual(p instanceof Promise, true);
    const slots = await p; assert.strictEqual(Array.isArray(slots), true);
  });
});