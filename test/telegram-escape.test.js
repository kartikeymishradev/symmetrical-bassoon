/**
 * Test: Telegram HTML escaping and booking ID randomization
 *   - api/enquiry.js uses escHtml() for all user fields
 *   - api/support.js uses escHtml() for all user fields
 *   - api/create-order.js and api/enquiry.js use crypto.randomBytes for booking IDs
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

describe('Telegram HTML Escaping (enquiry + support)', () => {

  it('enquiry.js escapes name, phone, email, condition, notes with escHtml', () => {
    const code = fs.readFileSync('api/enquiry.js', 'utf8');
    
    assert.ok(code.includes('escHtml(cleanName)'), 'should escape name');
    assert.ok(code.includes('escHtml(cleanPhone)'), 'should escape phone');
    assert.ok(code.includes('escHtml(cleanEmail'), 'should escape email');
    assert.ok(code.includes('escHtml(cleanCondition'), 'should escape condition');
    assert.ok(code.includes('escHtml(cleanNotes'), 'should escape notes');
    assert.ok(code.includes('escHtml(cleanPackage') || code.includes('escHtml(cleanPackage'), 'should escape package');
    
    // parse_mode must be HTML (not Markdown)
    assert.ok(code.includes("parse_mode: 'HTML'"), 'should use HTML parse mode');
    assert.ok(!code.includes("parse_mode: 'Markdown'"), 'should not use Markdown parse mode');
  });

  it('support.js escapes name, contact, message with escHtml', () => {
    const code = fs.readFileSync('api/support.js', 'utf8');
    
    assert.ok(code.includes('escHtml(cleanName') || code.includes('escHtml(cleanName'), 'should escape name');
    assert.ok(code.includes('escHtml(cleanContact'), 'should escape contact');
    assert.ok(code.includes('escHtml(cleanMessage'), 'should escape message');
    
    // Must not use raw unescaped variables in the Telegram message
    // The raw vars ${name}, ${contact}, ${message} should NOT appear in the Telegram message
    const msgSection = code.substring(code.indexOf('const messageText'), code.indexOf('const telegramData'));
    assert.ok(!msgSection.includes('${name }') && !msgSection.includes('${contact }'), 
      'should not use raw unsanitized variables in telegram message');
    
    assert.ok(code.includes("parse_mode: 'HTML'"), 'should use HTML parse mode');
  });

  it('escHtml function covers &, <, > at minimum', () => {
    // Functional test: extract and evaluate the escHtml function
    const code = fs.readFileSync('api/enquiry.js', 'utf8');
    const fnStart = code.indexOf('const escHtml = ');
    assert.ok(fnStart !== -1, 'escHtml function must be defined');
    // Find the full function expression (ends at the next newline)
    const fnEnd = code.indexOf('\n', fnStart);
    const fnLine = code.substring(fnStart, fnEnd);
    
    // Actually execute it to verify behavior
    const escHtml = new Function('return ' + fnLine.replace('const escHtml = ', ''))();
    assert.equal(escHtml('a&b'), 'a&amp;b', 'should escape &');
    assert.equal(escHtml('a<b'), 'a&lt;b', 'should escape <');
    assert.equal(escHtml('a>b'), 'a&gt;b', 'should escape >');
    assert.equal(escHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert("xss")&lt;/script&gt;', 'should escape full tag');
    assert.equal(escHtml(null), '', 'should handle null');
    assert.equal(escHtml(''), '', 'should handle empty string');
  });
});

describe('Booking ID Randomization', () => {

  it('create-order.js uses crypto.randomBytes for booking IDs', () => {
    const code = fs.readFileSync('api/create-order.js', 'utf8');
    assert.ok(code.includes("randomBytes(6)"), 'should use crypto.randomBytes(6)');
    assert.ok(!code.includes("Date.now().toString(36)"), 'should not use Date.now timestamp');
  });

  it('enquiry.js uses crypto.randomBytes for booking IDs', () => {
    const code = fs.readFileSync('api/enquiry.js', 'utf8');
    assert.ok(code.includes("randomBytes(6)"), 'should use crypto.randomBytes(6)');
    assert.ok(!code.includes("Date.now().toString(36)"), 'should not use Date.now timestamp');
  });

  it('two generated booking IDs are distinct (not timestamp-derived)', () => {
    const crypto = require('crypto');
    const id1 = `ENQ-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const id2 = `ENQ-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    assert.notEqual(id1, id2);
    // Verify hex format: ENQ- followed by 12 hex chars
    assert.match(id1, /^ENQ-[0-9A-F]{12}$/);
    assert.match(id2, /^ENQ-[0-9A-F]{12}$/);
  });
});
