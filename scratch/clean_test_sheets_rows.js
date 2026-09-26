/**
 * Cleanup script to remove all E2E test rows from 'Bookings' and 'Payments' tabs in Google Sheets.
 * Preserves header rows and genuine non-test records.
 */
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  let currentKey = null;
  let currentVal = [];
  let inQuotes = false;

  envContent.split('\n').forEach(line => {
    if (!inQuotes) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = line.indexOf('=');
        const key = line.substring(0, idx).trim();
        let val = line.substring(idx + 1).trim();

        if (val.startsWith('"') && (!val.endsWith('"') || val.length === 1)) {
          inQuotes = true;
          currentKey = key;
          currentVal = [val.substring(1)];
        } else {
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.substring(1, val.length - 1);
          }
          process.env[key] = val;
        }
      }
    } else {
      if (line.trim().endsWith('"')) {
        currentVal.push(line.trim().slice(0, -1));
        process.env[currentKey] = currentVal.join('\n');
        inQuotes = false;
        currentKey = null;
        currentVal = [];
      } else {
        currentVal.push(line);
      }
    }
  });
}

const { getSheetsClient } = require('../lib/sheets');

async function cleanTestSheetRows() {
  const { client, sheetId, error } = getSheetsClient();
  if (error || !client) {
    console.error('Sheets Client Error:', error);
    return;
  }

  console.log('================================================================');
  console.log('CLEANING E2E TEST ROWS FROM GOOGLE SHEETS (Bookings & Payments)');
  console.log('================================================================\n');

  // 1. Clean Bookings tab
  const bookingsRes = await client.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Bookings!A:Q'
  });

  const bRows = bookingsRes.data.values || [];
  console.log(`Bookings tab before cleanup: ${bRows.length} rows.`);

  const headerB = bRows[0] || [
    'booking_id', 'timestamp', 'patient_name', 'phone_number', 'email',
    'service_name', 'amount', 'payment_status', 'razorpay_payment_id',
    'razorpay_link_id', 'appointment_date', 'appointment_time',
    'appointment_status', 'calendar_event_id', 'telegram_status',
    'notes', 'updated_at'
  ];

  const cleanBRows = [headerB];
  let deletedBCount = 0;

  for (let i = 1; i < bRows.length; i++) {
    const r = bRows[i];
    const name = r[2] || '';
    const email = r[4] || '';
    const notes = r[15] || '';

    const isTestRow = name.includes('E2E TEST') || email.includes('.e2e@') || notes.includes('CANCELLED_TEST');

    if (isTestRow) {
      deletedBCount++;
    } else {
      cleanBRows.push(r);
    }
  }

  await client.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: 'Bookings!A:Q'
  });

  await client.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: 'Bookings!A1',
    valueInputOption: 'RAW',
    requestBody: { values: cleanBRows }
  });

  console.log(`✓ Bookings tab cleaned: Deleted ${deletedBCount} E2E test rows. Remaining rows: ${cleanBRows.length}.\n`);

  // 2. Clean Payments tab
  const paymentsRes = await client.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Payments!A:K'
  });

  const pRows = paymentsRes.data.values || [];
  console.log(`Payments tab before cleanup: ${pRows.length} rows.`);

  const headerP = pRows[0] || [
    'payment_id', 'booking_id', 'razorpay_payment_id', 'razorpay_order_id',
    'amount', 'currency', 'status', 'method', 'created_at', 'event_type', 'updated_at'
  ];

  const cleanPRows = [headerP];
  let deletedPCount = 0;

  for (let i = 1; i < pRows.length; i++) {
    const r = pRows[i];
    const rzpPayId = r[2] || '';
    const rzpOrdId = r[3] || '';

    const isTestPayment = rzpPayId.includes('pay_e2e_') || rzpOrdId.startsWith('order_mock_');

    if (isTestPayment) {
      deletedPCount++;
    } else {
      cleanPRows.push(r);
    }
  }

  await client.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: 'Payments!A:K'
  });

  await client.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: 'Payments!A1',
    valueInputOption: 'RAW',
    requestBody: { values: cleanPRows }
  });

  console.log(`✓ Payments tab cleaned: Deleted ${deletedPCount} E2E test rows. Remaining rows: ${cleanPRows.length}.\n`);
}

cleanTestSheetRows().catch(err => console.error('Sheet cleanup error:', err));
