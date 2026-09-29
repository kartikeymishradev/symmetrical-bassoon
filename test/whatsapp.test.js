const { test, describe, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const https = require('https');
const { sendWhatsAppConfirmation } = require('../lib/whatsapp');

describe('WhatsApp Security Hardening (P1-2)', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.WHATSAPP_API_TOKEN = 'test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '12345';
  });

  afterEach(() => {
    process.env = originalEnv;
    mock.restoreAll();
  });

  test('guards against JSON.parse failing on non-JSON response', async () => {
    mock.method(https, 'request', (options, cb) => {
      const res = {
        statusCode: 200,
        on: (event, handler) => {
          if (event === 'data') handler('<html>502 Bad Gateway</html>');
          if (event === 'end') handler();
        }
      };
      if (cb) cb(res);
      return {
        on: () => {},
        write: () => {},
        end: () => {}
      };
    });

    const result = await sendWhatsAppConfirmation({ bookingId: 'b1' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.response, '<html>502 Bad Gateway</html>');
  });

  test('uses WHATSAPP_API_VERSION with fallback', async () => {
    let capturedPath = '';
    mock.method(https, 'request', (options, cb) => {
      capturedPath = options.path;
      const res = {
        statusCode: 200,
        on: (event, handler) => { if (event === 'end') handler(); }
      };
      if (cb) cb(res);
      return { on: () => {}, write: () => {}, end: () => {} };
    });

    // Without env var, it should default to v18.0
    await sendWhatsAppConfirmation({ bookingId: 'b1' });
    assert.strictEqual(capturedPath, '/v18.0/12345/messages');

    // With env var, it should use it
    process.env.WHATSAPP_API_VERSION = 'v20.0';
    await sendWhatsAppConfirmation({ bookingId: 'b2' });
    assert.strictEqual(capturedPath, '/v20.0/12345/messages');
  });

  test('sanitises patientName by trimming and removing newlines', async () => {
    let capturedPayload = '';
    mock.method(https, 'request', (options, cb) => {
      const res = {
        statusCode: 200,
        on: (event, handler) => { if (event === 'end') handler(); }
      };
      if (cb) cb(res);
      return {
        on: () => {},
        write: (data) => { capturedPayload = data; },
        end: () => {}
      };
    });

    await sendWhatsAppConfirmation({ 
      bookingId: 'b1',
      patientName: 'John\r\nDoe\nSmith' 
    });
    
    const parsed = JSON.parse(capturedPayload);
    const patientNameParam = parsed.template.components[0].parameters[0].text;
    assert.strictEqual(patientNameParam, 'John Doe Smith');
  });
});
