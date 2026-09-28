const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { isAllowedOrigin } = require('../lib/cors');

describe('CORS Security Hardening (P1-1)', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalVercel = process.env.VERCEL_URL;
  const originalAllowed = process.env.ALLOWED_ORIGINS;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.VERCEL_URL;
    delete process.env.ALLOWED_ORIGINS;
  });

  test('allows canonical production domains', () => {
    assert.strictEqual(isAllowedOrigin('https://revahealth.in'), true);
    assert.strictEqual(isAllowedOrigin('https://www.revahealth.in'), true);
  });

  test('rejects arbitrary vercel.app domains', () => {
    assert.strictEqual(isAllowedOrigin('https://malicious-app.vercel.app'), false);
    assert.strictEqual(isAllowedOrigin('http://hacker.vercel.app'), false);
  });

  test('allows exact VERCEL_URL domain', () => {
    process.env.VERCEL_URL = 'symmetrical-bassoon-123.vercel.app';
    assert.strictEqual(isAllowedOrigin('https://symmetrical-bassoon-123.vercel.app'), true);
    // Should not allow subdomains of the VERCEL_URL or different protocols
    assert.strictEqual(isAllowedOrigin('http://symmetrical-bassoon-123.vercel.app'), false);
  });

  test('allows custom domains in ALLOWED_ORIGINS', () => {
    process.env.ALLOWED_ORIGINS = 'https://custom.example.com, http://test.local';
    assert.strictEqual(isAllowedOrigin('https://custom.example.com'), true);
    assert.strictEqual(isAllowedOrigin('http://test.local'), true);
    assert.strictEqual(isAllowedOrigin('https://other.example.com'), false);
  });

  test('allows localhost ONLY when not in production', () => {
    process.env.NODE_ENV = 'development';
    assert.strictEqual(isAllowedOrigin('http://localhost:3000'), true);
    assert.strictEqual(isAllowedOrigin('http://127.0.0.1:8080'), true);

    process.env.NODE_ENV = 'production';
    assert.strictEqual(isAllowedOrigin('http://localhost:3000'), false);
    assert.strictEqual(isAllowedOrigin('http://127.0.0.1:8080'), false);
  });
});
