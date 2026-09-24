/**
 * Temporary Serverless API Endpoint: Google Sheets Integration Test
 * Route: GET or POST /api/test-sheets
 *
 * Tests connection to Google Sheets API using Service Account credentials
 * and appends a dummy row [TEST-001] to the 'Bookings' sheet.
 * Credentials are NEVER exposed or logged.
 */

const crypto = require('crypto');
const https = require('https');

function base64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getGoogleAccessToken(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedClaimSet = base64url(JSON.stringify(claimSet));
  const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signatureInput);
  signer.write(signatureInput);
  signer.end();
  const signature = signer.sign(privateKey);
  const jwt = `${signatureInput}.${base64url(signature)}`;

  const postData = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300 && parsed.access_token) {
            resolve(parsed.access_token);
          } else {
            const errMsg = parsed.error_description || parsed.error || `HTTP ${res.statusCode}`;
            reject(new Error(`Google OAuth Auth Failed: ${errMsg}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Google OAuth response: ${e.message}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`OAuth Request Network Error: ${err.message}`)));
    req.write(postData);
    req.end();
  });
}

async function appendToGoogleSheet(accessToken, sheetId, range, rowValues) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
  const postData = JSON.stringify({
    values: [rowValues]
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const errMsg = parsed.error ? parsed.error.message : `HTTP ${res.statusCode}`;
            reject(new Error(`Google Sheets API Error: ${errMsg}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Sheets API response: ${e.message}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Sheets Request Network Error: ${err.message}`)));
    req.write(postData);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Resolve Env Variables (Support standard naming variations)
  const sheetId = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SPREADSHEET_ID || process.env.SPREADSHEET_ID;
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (privateKey) {
    privateKey = privateKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
  }

  const missingVars = [];
  if (!sheetId) missingVars.push('GOOGLE_SHEET_ID');
  if (!clientEmail) missingVars.push('GOOGLE_CLIENT_EMAIL');
  if (!privateKey) missingVars.push('GOOGLE_PRIVATE_KEY');

  if (missingVars.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing Google Sheets Environment Variables',
      missingVariables: missingVars,
      hint: 'Ensure GOOGLE_SHEET_ID, GOOGLE_CLIENT_EMAIL, and GOOGLE_PRIVATE_KEY are set in Vercel or .env'
    });
  }

  const timestamp = new Date().toISOString();
  const dummyRow = [
    'TEST-001',
    'Dummy Patient Test',
    '+91 9999999999',
    'Doctor Consultation (₹400)',
    'General Medicine',
    timestamp.split('T')[0],
    `Test append entry generated at ${timestamp}`
  ];

  try {
    // Step 1: Exchange Service Account JWT for OAuth Access Token
    const accessToken = await getGoogleAccessToken(clientEmail, privateKey);

    // Step 2: Append Dummy Row to 'Bookings' Sheet
    const sheetResult = await appendToGoogleSheet(accessToken, sheetId, 'Bookings', dummyRow);

    return res.status(200).json({
      success: true,
      message: 'Google Sheets connection successful! Dummy row TEST-001 appended to Bookings sheet.',
      appendedRange: sheetResult.updates ? sheetResult.updates.updatedRange : 'Bookings',
      updatedRows: sheetResult.updates ? sheetResult.updates.updatedRows : 1,
      dummyRow: dummyRow
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to connect to Google Sheets API',
      hint: 'Verify Service Account permissions on the spreadsheet and check private key formatting.'
    });
  }
};
