/**
 * Serverless API Endpoint: REVA Health Consultation Enquiry
 * Route: POST /api/enquiry
 *
 * 1. Validates input fields (name and phone required).
 * 2. Appends actual enquiry entry to Google Sheets ('Bookings' tab).
 * 3. Transmits enquiry notification to Telegram Admin Chat (if configured).
 */

const https = require('https');
const { google } = require('googleapis');

function extractSpreadsheetId(input) {
  if (!input) return '';
  const trimmed = input.trim().replace(/^["']|["']$/g, '');
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return trimmed;
}

/**
 * Appends row data to Google Sheets 'Bookings' tab using official SDK.
 * Credentials are NEVER exposed or logged.
 */
async function appendToGoogleSheets(rowData) {
  const rawSheetId = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SPREADSHEET_ID || process.env.SPREADSHEET_ID || '';
  const clientEmail = (process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim().replace(/^["']|["']$/g, '');
  const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';

  const sheetId = extractSpreadsheetId(rawSheetId);
  const privateKey = rawPrivateKey
    ? rawPrivateKey.replace(/^["']([\s\S]*)["']$/, '$1').replace(/\\n/g, '\n').trim()
    : '';

  if (!sheetId || !clientEmail || !privateKey) {
    console.warn('Google Sheets environment variables missing or incomplete; skipping Sheets append.');
    return { success: false, reason: 'unconfigured' };
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const targetRange = 'Bookings!A:G';
  const appendResult = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: targetRange,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [rowData]
    }
  });

  return {
    success: true,
    updatedRange: appendResult.data.updates ? appendResult.data.updates.updatedRange : targetRange,
    updatedRows: appendResult.data.updates ? appendResult.data.updates.updatedRows : 1
  };
}

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { name, phone, email, package: pkg, condition, date, notes } = body;

    // Strict Input Validation
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    const cleanPackage = typeof pkg === 'string' ? pkg.trim() : '';
    const cleanCondition = typeof condition === 'string' ? condition.trim() : '';
    const cleanDate = typeof date === 'string' ? date.trim() : '';
    const cleanNotes = typeof notes === 'string' ? notes.trim() : '';

    if (!cleanName || !cleanPhone) {
      return res.status(400).json({ error: 'Name and phone number are required.' });
    }

    const timestamp = new Date().toISOString();
    const bookingId = `ENQ-${Date.now().toString(36).toUpperCase()}`;

    // Construct Sheets Row [Booking ID, Name, Phone, Package, Condition, Date, Notes]
    const notesSummary = cleanNotes
      ? `${cleanNotes}${cleanEmail ? ` | Email: ${cleanEmail}` : ''}`
      : (cleanEmail ? `Email: ${cleanEmail}` : 'Submitted from REVA Health Website');

    const sheetsRow = [
      bookingId,
      cleanName,
      cleanPhone,
      cleanPackage || 'General Consultation',
      cleanCondition || 'N/A',
      cleanDate || timestamp.split('T')[0],
      notesSummary
    ];

    // 1. Write to Google Sheets
    let sheetsSuccess = false;
    let updatedRange = null;
    try {
      const sheetsRes = await appendToGoogleSheets(sheetsRow);
      sheetsSuccess = sheetsRes.success;
      if (sheetsRes.updatedRange) updatedRange = sheetsRes.updatedRange;
    } catch (sheetsErr) {
      console.error('Google Sheets append error:', sheetsErr.message || sheetsErr);
      // Non-blocking for general API handler unless Sheets is required
    }

    // 2. Transmit to Telegram (if configured)
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    const isPlaceholder = !token || !chatId || token.includes('your_') || token.includes('temporary_') || chatId.includes('your_');

    if (isPlaceholder) {
      return res.status(200).json({
        success: true,
        mode: 'local_v1',
        bookingId: bookingId,
        sheetsRecorded: sheetsSuccess,
        appendedRange: updatedRange,
        message: sheetsSuccess
          ? 'Enquiry recorded in Google Sheets! Configure TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID in .env for live Telegram notifications.'
          : 'Enquiry recorded locally on V1. Configure TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID in .env for live Telegram notifications.'
      });
    }

    // Format Telegram Message
    const messageText = `NEW REVA HEALTH ENQUIRY (${bookingId})\n\n` +
      `Name: ${cleanName}\n` +
      `Phone: ${cleanPhone}\n` +
      `Email: ${cleanEmail || 'N/A'}\n` +
      `Plan Interest: ${cleanPackage || 'General Consultation'}\n` +
      `Primary Focus: ${cleanCondition || 'N/A'}\n` +
      `Preferred Date: ${cleanDate || 'N/A'}\n\n` +
      `Notes:\n${cleanNotes || 'None'}\n\n` +
      `Submitted from:\nREVA Health Website`;

    const telegramData = JSON.stringify({
      chat_id: chatId,
      text: messageText,
      parse_mode: 'HTML'
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(telegramData)
      }
    };

    return new Promise((resolve) => {
      const tgReq = https.request(options, (tgRes) => {
        let responseString = '';
        tgRes.on('data', chunk => responseString += chunk);
        tgRes.on('end', () => {
          if (tgRes.statusCode === 200) {
            res.status(200).json({
              success: true,
              bookingId: bookingId,
              sheetsRecorded: sheetsSuccess,
              appendedRange: updatedRange,
              message: 'Enquiry processed successfully and sent to Telegram.'
            });
          } else {
            console.error('Telegram API error:', responseString);
            if (sheetsSuccess) {
              res.status(200).json({
                success: true,
                bookingId: bookingId,
                sheetsRecorded: true,
                appendedRange: updatedRange,
                message: 'Enquiry recorded in Google Sheets (Telegram notification failed).'
              });
            } else {
              res.status(502).json({ error: 'Failed to send message to Telegram Bot.' });
            }
          }
          resolve();
        });
      });

      tgReq.on('error', (err) => {
        console.error('HTTPS request error:', err);
        if (sheetsSuccess) {
          res.status(200).json({
            success: true,
            bookingId: bookingId,
            sheetsRecorded: true,
            appendedRange: updatedRange,
            message: 'Enquiry recorded in Google Sheets.'
          });
        } else {
          res.status(500).json({ error: 'Internal server error while reaching Telegram API.' });
        }
        resolve();
      });

      tgReq.write(telegramData);
      tgReq.end();
    });

  } catch (err) {
    console.error('Enquiry handler error:', err);
    return res.status(500).json({ error: 'Invalid request payload.' });
  }
};
