const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');

describe('Server Security Hardening (P1-4)', () => {
  let serverProcess;
  const PORT = 3001;

  before(async () => {
    return new Promise((resolve, reject) => {
      serverProcess = spawn('node', ['server.js'], { 
        env: { ...process.env, PORT: PORT.toString(), HOST: '127.0.0.1' } 
      });
      serverProcess.stdout.on('data', (data) => {
        const out = data.toString();
        if (out.includes(`running at`)) {
          resolve();
        }
      });
      serverProcess.stderr.on('data', (data) => {
        console.error('Server error:', data.toString());
      });
      serverProcess.on('error', reject);
    });
  });

  after(() => {
    if (serverProcess) serverProcess.kill();
  });

  const fetchUrl = (path, options = {}) => {
    return new Promise((resolve) => {
      const req = http.request(`http://127.0.0.1:${PORT}${path}`, options, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      if (options.body) req.write(options.body);
      req.end();
    });
  };

  test('blocks dotfiles', async () => {
    const res = await fetchUrl('/.env');
    assert.strictEqual(res.status, 403);
  });

  test('prevents path traversal to backend files', async () => {
    const res1 = await fetchUrl('/../server.js');
    assert.strictEqual(res1.status, 403);
    
    const res2 = await fetchUrl('/%2e%2e/package.json');
    assert.strictEqual(res2.status, 403);
  });

  test('enforces allowlist (blocks /server.js, /api/enquiry.js directly)', async () => {
    const res1 = await fetchUrl('/server.js');
    assert.strictEqual(res1.status, 403);

    const res2 = await fetchUrl('/api/enquiry.js');
    assert.strictEqual(res2.status, 403);
  });

  test('allows permitted public assets', async () => {
    const res1 = await fetchUrl('/');
    assert.strictEqual(res1.status, 200);

    const res2 = await fetchUrl('/css/style.css');
    // It might be 404 if css/style.css doesn't exist, but it shouldn't be 403.
    assert.notStrictEqual(res2.status, 403);
  });

  test('caps POST payload body size to 100KB', async () => {
    const bigBody = Buffer.alloc(105 * 1024, 'a').toString('utf-8');
    const res = await fetchUrl('/api/enquiry', { method: 'POST', body: bigBody });
    assert.strictEqual(res.status, 413);
    assert.strictEqual(res.body, 'Payload Too Large');
  });

});
