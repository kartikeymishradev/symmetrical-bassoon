/**
 * Temporary Serverless API Endpoint: Google Sheets Integration Test
 * Route: GET or POST /api/test-sheets
 *
 * Uses official `googleapis` SDK with GoogleAuth credentials.
 * Appends dummy row [TEST-001] to 'Bookings' sheet.
 * Credentials are NEVER exposed or logged.
 */

const { google } = require('googleapis');

function extractSpreadsheetId(input) {
  if (!input) return '';
  const trimmed = input.trim().replace(/^["']|["']$/g, '');
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return trimmed;
}

function sanitizeSecret(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
             .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[REDACTED_JWT_TOKEN]');
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
  const rawSheetId = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SPREADSHEET_ID || process.env.SPREADSHEET_ID || '';
  const clientEmail = (process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim().replace(/^["']|["']$/g, '');
  const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';

  const sheetId = extractSpreadsheetId(rawSheetId);

  // Private Key Normalization (Supports multi-line, escaped newlines, and surrounding quotes)
  const privateKey = rawPrivateKey
    ? rawPrivateKey.replace(/^["']([\s\S]*)["']$/, '$1').replace(/\\n/g, '\n').trim()
    : '';

  // Safe Key Diagnostics
  const diagnostics = {
    exists: Boolean(rawPrivateKey),
    rawLength: rawPrivateKey.length,
    literalNewlineCount: (rawPrivateKey.match(/\\n/g) || []).length,
    realNewlineCount: (rawPrivateKey.match(/\n/g) || []).length,
    startsWithHeader: privateKey.startsWith('-----BEGIN PRIVATE KEY-----') || privateKey.startsWith('-----BEGIN RSA PRIVATE KEY-----'),
    endsWithFooter: privateKey.endsWith('-----END PRIVATE KEY-----') || privateKey.endsWith('-----END RSA PRIVATE KEY-----'),
    normalizedLength: privateKey.length,
    sheetIdParsed: sheetId ? `${sheetId.substring(0, 6)}...${sheetId.substring(Math.max(0, sheetId.length - 4))}` : 'MISSING',
    clientEmailParsed: clientEmail ? `${clientEmail.substring(0, 6)}...` : 'MISSING'
  };

  const missingVars = [];
  if (!sheetId) missingVars.push('GOOGLE_SHEET_ID');
  if (!clientEmail) missingVars.push('GOOGLE_CLIENT_EMAIL');
  if (!privateKey) missingVars.push('GOOGLE_PRIVATE_KEY');

  if (missingVars.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing Google Sheets Environment Variables',
      missingVariables: missingVars,
      keyDiagnostics: diagnostics,
      hint: 'Ensure GOOGLE_SHEET_ID, GOOGLE_CLIENT_EMAIL, and GOOGLE_PRIVATE_KEY are set in Vercel or .env'
    });
  }

  const timestamp = new Date().toISOString();
  const dummyRow = [
    'TEST-001',
    timestamp,
    'Dummy Patient Test',
    '+91 9999999999',
    'test@revahealth.com',
    'Doctor Consultation (₹400)',
    400,
    'PENDING',
    '',
    '',
    timestamp.split('T')[0],
    '',
    'REQUESTED',
    '',
    'LOCAL',
    `Test append entry generated at ${timestamp}`,
    timestamp
  ];

  try {
    // Step 1: Initialize Official GoogleAuth Client SDK
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Step 2: Append Dummy Row to 'Bookings' Sheet
    const targetRange = 'Bookings!A:Q';
    const appendResult = await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: targetRange,
      valueInputOption: 'RAW',
      requestBody: {
        values: [dummyRow]
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Google Sheets connection successful! Dummy row TEST-001 appended to Bookings sheet.',
      appendedRange: appendResult.data.updates ? appendResult.data.updates.updatedRange : targetRange,
      updatedRows: appendResult.data.updates ? appendResult.data.updates.updatedRows : 1,
      keyDiagnostics: diagnostics,
      dummyRow: dummyRow
    });

  } catch (err) {
    const statusCode = err.code || err.status || (err.response ? err.response.status : 500);
    const contentType = err.response && err.response.headers ? err.response.headers['content-type'] : 'unknown';
    const rawResponseBody = err.response && err.response.data
      ? (typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data))
      : err.message || '';

    const sanitizedSnippet = sanitizeSecret(rawResponseBody).substring(0, 100);

    return res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
      success: false,
      error: 'Google Sheets API Request Failed',
      httpStatusCode: statusCode,
      contentType: contentType,
      responseSnippetFirst100Chars: sanitizedSnippet,
      targetSpreadsheetIdPreview: `${sheetId.substring(0, 6)}...${sheetId.substring(Math.max(0, sheetId.length - 4))}`,
      keyDiagnostics: diagnostics,
      hint: 'Check spreadsheet sharing (must be shared with client_email as Editor) and tab name (must have a tab named "Bookings").'
    });
  }
};
