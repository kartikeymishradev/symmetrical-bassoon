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
 * Appends a row to the 'Bookings' tab matching exact 17 columns (A:Q). Uses RAW input.
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
      valueInputOption: 'RAW',
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
      return { success: true, services: [] };
    }

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
 * Helper to get exact amount from Services sheet first, falling back to safe fixed default (400).
 * Never extracts prices directly from unverified client inputs.
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
    // Ignore error and use default
  }

  // Always return fixed safe default (400 INR) if no exact match found in Services sheet
  return 400;
}

/**
 * Appends a transaction record to the 'Payments' tab matching exact 11 columns (A:K). Uses RAW input.
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
 * Updates payment_status, appointment_status, razorpay_payment_id, and razorpay_link_id in 'Bookings' for a given booking_id.
 */
async function updateBookingPaymentStatus(bookingId, paymentStatus, razorpayPaymentId = '', razorpayLinkId = '', appointmentStatus = 'CONFIRMED') {
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

    // Update payment_status (Col H), razorpay_payment_id (Col I), razorpay_link_id (Col J)
    await client.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Bookings!H${rowIndex}:J${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[paymentStatus, razorpayPaymentId, razorpayLinkId]]
      }
    });

    // Update appointment_status (Col M)
    await client.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Bookings!M${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[appointmentStatus]]
      }
    });

    // Update updated_at (Col Q)
    await client.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Bookings!Q${rowIndex}`,
      valueInputOption: 'RAW',
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

/**
 * Checks active slot holds in 'Bookings' for concurrency prevention.
 * Returns busy ranges for bookings in SLOT_HOLD / PAYMENT_PENDING where hold_expires_at is active.
 */
async function fetchActiveSlotHolds(targetDateStr) {
  const { client, sheetId, error } = getSheetsClient();
  if (error || !client) return [];

  const holdExpiryMinutes = parseInt(process.env.HOLD_EXPIRY_MINUTES || '15', 10);
  const nowTime = Date.now();

  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Bookings!A:Q'
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return [];

    const busySlots = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const date = r[10] || '';
      const time = r[11] || '';
      const apptStatus = r[12] || '';
      const updatedAt = r[16] || r[1] || '';

      if (date === targetDateStr && (apptStatus === 'SLOT_HOLD' || apptStatus === 'PAYMENT_PENDING' || apptStatus === 'CONFIRMED' || apptStatus === 'REQUESTED')) {
        let isHoldActive = true;
        if (apptStatus === 'SLOT_HOLD' || apptStatus === 'PAYMENT_PENDING') {
          const updatedTimestamp = new Date(updatedAt).getTime();
          if (updatedTimestamp && (nowTime - updatedTimestamp > holdExpiryMinutes * 60 * 1000)) {
            isHoldActive = false; // Expiry reached
          }
        }

        if (isHoldActive && time) {
          // Construct start ISO for freebusy comparison
          let startIso = `${date}T10:00:00+05:30`;
          let endIso = `${date}T10:30:00+05:30`;
          if (time.includes(':')) {
            const m = time.match(/(\d+):(\d+)\s*(AM|PM)?/i);
            if (m) {
              let h = parseInt(m[1], 10);
              const min = parseInt(m[2], 10);
              const ampm = m[3] ? m[3].toUpperCase() : '';
              if (ampm === 'PM' && h < 12) h += 12;
              if (ampm === 'AM' && h === 12) h = 0;
              const hStr = String(h).padStart(2, '0');
              const minStr = String(min).padStart(2, '0');
              startIso = `${date}T${hStr}:${minStr}:00+05:30`;
              const endH = h + Math.floor((min + 30) / 60);
              const endMin = (min + 30) % 60;
              endIso = `${date}T${String(endH).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00+05:30`;
            }
          }
          busySlots.push({ startIso, endIso, time });
        }
      }
    }
    return busySlots;
  } catch (err) {
    console.error('Error fetching active slot holds from Sheets:', err.message);
    return [];
  }
}

/**
 * Idempotency Check: Returns true if payment_id or booking_id has already been recorded in 'Payments' tab.
 */
async function isPaymentRecorded(paymentId, bookingId) {
  const { client, sheetId, error } = getSheetsClient();
  if (error || !client) return false;

  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Payments!A:K'
    });

    const rows = res.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if ((paymentId && r[2] === paymentId) || (bookingId && r[1] === bookingId && r[6] === 'captured')) {
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error('Error checking payment idempotency in Sheets:', err.message);
    return false;
  }
}

/**
 * Reads all booking records from the 'Bookings' tab (A:Q).
 */
async function getAllBookings() {
  const { client, sheetId, error } = getSheetsClient();
  if (error || !client) {
    return { success: false, bookings: [], error: error || 'unconfigured' };
  }

  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Bookings!A:Q'
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) {
      return { success: true, bookings: [] };
    }

    const bookings = rows.slice(1).map((r, idx) => ({
      rowIndex: idx + 2,
      booking_id: r[0] || '',
      timestamp: r[1] || '',
      patient_name: r[2] || '',
      phone_number: r[3] || '',
      email: r[4] || '',
      service_name: r[5] || '',
      amount: r[6] || '',
      payment_status: r[7] || '',
      razorpay_payment_id: r[8] || '',
      razorpay_link_id: r[9] || '',
      appointment_date: r[10] || '',
      appointment_time: r[11] || '',
      appointment_status: r[12] || '',
      calendar_event_id: r[13] || '',
      telegram_status: r[14] || '',
      notes: r[15] || '',
      updated_at: r[16] || ''
    }));

    return { success: true, bookings };
  } catch (err) {
    console.error('Error reading Bookings tab:', err.message);
    return { success: false, bookings: [], error: err.message };
  }
}

/**
 * Reads all payment records from the 'Payments' tab (A:K).
 */
async function getAllPayments() {
  const { client, sheetId, error } = getSheetsClient();
  if (error || !client) {
    return { success: false, payments: [], error: error || 'unconfigured' };
  }

  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Payments!A:K'
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) {
      return { success: true, payments: [] };
    }

    const payments = rows.slice(1).map((r, idx) => ({
      rowIndex: idx + 2,
      payment_id: r[0] || '',
      booking_id: r[1] || '',
      razorpay_payment_id: r[2] || '',
      razorpay_order_id: r[3] || '',
      amount: r[4] || '',
      currency: r[5] || '',
      status: r[6] || '',
      method: r[7] || '',
      created_at: r[8] || '',
      event_type: r[9] || '',
      raw_payload: r[10] || ''
    }));

    return { success: true, payments };
  } catch (err) {
    console.error('Error reading Payments tab:', err.message);
    return { success: false, payments: [], error: err.message };
  }
}

/**
 * Updates calendar_event_id (Col N) and appointment_status (Col M) for a booking.
 */
async function updateBookingCalendarDetails(bookingId, calendarEventId, appointmentStatus = 'CONFIRMED') {
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

    // Update appointment_status (Col M) and calendar_event_id (Col N)
    await client.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Bookings!M${rowIndex}:N${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[appointmentStatus, calendarEventId || '']]
      }
    });

    // Update updated_at (Col Q)
    await client.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Bookings!Q${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[timestamp]]
      }
    });

    return { success: true, updatedRow: rowIndex };
  } catch (err) {
    console.error('Error updating booking calendar details:', err.message);
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
  updateBookingPaymentStatus,
  fetchActiveSlotHolds,
  isPaymentRecorded,
  getAllBookings,
  getAllPayments,
  updateBookingCalendarDetails
};
