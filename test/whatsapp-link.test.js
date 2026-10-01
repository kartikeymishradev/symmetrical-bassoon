const test = require('node:test');
const assert = require('node:assert');
const { buildWhatsAppLink } = require('../lib/whatsapp-link');

test('WhatsApp Link Builder (wa.me)', async (t) => {
  await t.test('10-digit number -> correctly prefixed with 91, URL-encoded', () => {
    const link = buildWhatsAppLink('9876543210', 'Hello world');
    assert.strictEqual(link, 'https://wa.me/919876543210?text=Hello%20world');
  });

  await t.test('already-91-prefixed 12-digit number -> unchanged', () => {
    const link = buildWhatsAppLink('+91 98765 43210', 'Hi!');
    assert.strictEqual(link, 'https://wa.me/919876543210?text=Hi!');
  });

  await t.test('invalid/empty phone -> empty string returned', () => {
    assert.strictEqual(buildWhatsAppLink('123', 'Hi'), '');
    assert.strictEqual(buildWhatsAppLink('', 'Hi'), '');
    assert.strictEqual(buildWhatsAppLink(null, 'Hi'), '');
    assert.strictEqual(buildWhatsAppLink('abcdef', 'Hi'), '');
  });

  await t.test('message text with special characters -> correctly URL-encoded', () => {
    const link = buildWhatsAppLink('9876543210', 'Hi! 👋 How are you & your family?');
    assert.ok(link.includes('wa.me/919876543210'));
    assert.ok(link.includes('%F0%9F%91%8B')); // Emoji encoding
    assert.ok(link.includes('%26')); // Ampersand encoding
  });
});
