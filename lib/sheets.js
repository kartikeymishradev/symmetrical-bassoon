/**
 * REVA Health — Shared Google Sheets Service Layer
 *
 * Centralizes Google Sheets SDK authentication, environment variable normalization,
 * and data CRUD operations across Bookings, Services, and Payments tabs.
 */

const { google } = require('googleapis');

function extractSpreadsheetId(input) {
  if (!input) return '';
  const trimmed = input.trim().replace(/^["']|["']$/g, '');
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return trimmed;
}

/**
 * Initializes and returns GoogleAuth + Sheets client instance.
 * Safe against environment variable variations. Never logs credentials.
 */
function getSheetsClient() {
  const rawSheetId = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SPREADSHEET_ID || process.env.SPREADSHEET_ID || '';
  const clientEmail = (process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim().replace(/^["']|["']$/g, '');
  const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';

  const sheetId = extractSpreadsheetId(rawSheetId);
  const privateKey = rawPrivateKey
    ? rawPrivateKey.replace(/^["']([\s\S]*)["']$/, '$1').replace(/\\n/g, '\n').trim()
    : '';

  if (!sheetId || !clientEmail || !privateKey) {
    return { client: null, sheetId: null, error: 'Google Sheets environment variables missing or incomplete.' };
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    return { client: sheets, sheetId: sheetId, error: null };
  } catch (err) {
    return { client: null, sheetId: null, error: err.message };
  }
}

/**
 * Appends a row to the 'Bookings' tab matching exact 17 columns (A:Q).
 */
async function appendBooking(bookingData) {
  const { client, sheetId, error } = getSheetsClient();
  if (error || !client) {
    console.warn('Google Sheets unconfigured/error:', error);
    return { success: false, reason: error || 'unconfigured' };
  }

  const targetRange = 'Bookings!A:Q';
  const appendResult = await client.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: targetRange,
    valueInputOption: 'RAW',
    requestBody: {
      values: [bookingData]
    }
  });

  return {
    success: true,
    updatedRange: appendResult.data.updates ? appendResult.data.updates.updatedRange : targetRange,
    updatedRows: appendResult.data.updates ? appendResult.data.updates.updatedRows : 1
  };
}

/**
 * Updates telegram_status (Column O / Col 15) in 'Bookings' tab for a specific booking_id.
 */
async function updateBookingTelegramStatus(bookingId, status) {
  const { client, sheetId, error } = getSheetsClient();
  if (error || !client || !bookingId) return { success: false };

  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Bookings!A:A'
    });

    const rows = res.data.values || [];
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === bookingId) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) return { success: false };

    await client.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Bookings!O${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[status]]
      }
    });

    return { success: true };
  } catch (err) {
    console.error('Error updating telegram status:', err.message);
    return { success: false };
  }
}

/**
 * Reads all active services from the 'Services' tab (A:D).
 */
async function fetchServices() {
  const { client, sheetId, error } = getSheetsClient();
  if (error || !client) {
    return { success: false, services: [], error };
  }

  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Services!A:D'
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) {
      return { success: true, services: [] }; // Header only or empty
    }

    // Skip header row
    const services = rows.slice(1).map(row => ({
      service_id: row[0] || '',
      service_name: row[1] || '',
      amount: parseFloat(row[2]) || 0,
      active: String(row[3]).toUpperCase() === 'TRUE' || String(row[3]) === '1'
    })).filter(s => s.service_name);

    return { success: true, services };
  } catch (err) {
    console.error('Error fetching Services sheet:', err.message);
    return { success: false, services: [], error: err.message };
  }
}

/**
 * Helper to get exact amount from Services sheet first, falling back to string extraction.
 */
async function getServiceAmount(serviceName, pkgString) {
  try {
    const { services } = await fetchServices();
    if (services && services.length > 0) {
      const match = services.find(s =>
        s.service_name.toLowerCase().trim() === (serviceName || '').toLowerCase().trim()
      );
      if (match && typeof match.amount === 'number' && !isNaN(match.amount)) {
        return match.amount;
      }
    }
  } catch (e) {
    // Ignore error and use fallback
  }

  if (typeof pkgString === 'string') {
    const m = pkgString.match(/₹\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
  }

  return '';
}

/**
 * Appends a transaction record to the 'Payments' tab matching exact 11 columns (A:K).
 * Reusable helper — ONLY invoked when authentic payment details are available.
 */
async function appendPayment(paymentData) {
  const { client, sheetId, error } = getSheetsClient();
  if (error || !client) {
    return { success: false, reason: error || 'unconfigured' };
  }

  const targetRange = 'Payments!A:K';
  const appendResult = await client.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: targetRange,
    valueInputOption: 'RAW',
    requestBody: {
      values: [paymentData]
    }
  });

  return {
    success: true,
    updatedRange: appendResult.data.updates ? appendResult.data.updates.updatedRange : targetRange
  };
}

/**
 * Updates payment_status, razorpay_payment_id, and razorpay_link_id in 'Bookings' for a given booking_id.
 * Reusable helper — ONLY invoked when authentic payment details are available.
 */
async function updateBookingPaymentStatus(bookingId, paymentStatus, razorpayPaymentId = '', razorpayLinkId = '') {
  const { client, sheetId, error } = getSheetsClient();
  if (error || !client || !bookingId) {
    return { success: false, reason: error || 'invalid_booking_id' };
  }

  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Bookings!A:A'
    });

    const rows = res.data.values || [];
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === bookingId) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) {
      return { success: false, reason: 'booking_id_not_found' };
    }

    const timestamp = new Date().toISOString();

    await client.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Bookings!H${rowIndex}:J${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[paymentStatus, razorpayPaymentId, razorpayLinkId]]
      }
    });

    await client.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Bookings!Q${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[timestamp]]
      }
    });

    return { success: true, updatedRow: rowIndex };
  } catch (err) {
    console.error('Error updating booking payment status:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  extractSpreadsheetId,
  getSheetsClient,
  appendBooking,
  updateBookingTelegramStatus,
  fetchServices,
  getServiceAmount,
  appendPayment,
  updateBookingPaymentStatus
};
