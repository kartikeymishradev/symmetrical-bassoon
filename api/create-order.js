/**
 * Serverless API Endpoint: REVA Health Create Razorpay Order & Booking Slot Hold
 * Route: POST /api/create-order
 *
 * 1. Validates input fields (name, phone required).
 * 2. Checks slot availability against Google Calendar & Sheets active holds.
 * 3. Appends temporary SLOT_HOLD record to Google Sheets 'Bookings' tab (17 columns A:Q, RAW).
 * 4. Write-Verification Guard: Re-reads Sheets to verify no earlier request claimed the slot.
 *    If conflicting reservation exists, marks booking SLOT_CONFLICT_CANCELLED & returns 409 Conflict.
 * 5. Calls createRazorpayOrder() and returns order details for Razorpay Checkout SDK.
 */

const { appendBooking, getServiceAmount, fetchActiveSlotHolds, updateBookingPaymentStatus, getSheetsClient } = require('../lib/sheets');
const { createRazorpayOrder } = require('../lib/razorpay');
const { checkRateLimit } = require('../lib/ratelimit');

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

  // Rate Limiting (10 requests per minute per IP)
  const rateCheck = checkRateLimit(req, 10, 60 * 1000);
  if (rateCheck.limited) {
    return res.status(429).json({ error: `Too many order creation attempts. Please wait ${rateCheck.resetInSec} seconds before retrying.` });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { name, phone, email, package: pkg, condition, date, time, notes } = body;

    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    const cleanPackage = typeof pkg === 'string' ? pkg.trim() : '';
    const cleanCondition = typeof condition === 'string' ? condition.trim() : '';
    const cleanDate = typeof date === 'string' ? date.trim() : '';
    const cleanTime = typeof time === 'string' ? time.trim() : '';
    const cleanNotes = typeof notes === 'string' ? notes.trim() : '';

    if (!cleanName || !cleanPhone) {
      return res.status(400).json({ error: 'Name and phone number are required.' });
    }

    const timestamp = new Date().toISOString();
    const bookingId = `ENQ-${Date.now().toString(36).toUpperCase()}`;

    // 1. Initial Slot Availability & Hold Check
    if (cleanDate && cleanTime) {
      const activeHolds = await fetchActiveSlotHolds(cleanDate);
      const isSlotHeld = activeHolds.some(h => h.time === cleanTime);
      if (isSlotHeld) {
        return res.status(409).json({
          error: 'Slot is temporarily held by another patient. Please select a different time.',
          conflict: true
        });
      }
    }

    // Resolve numeric amount
    const numericAmount = await getServiceAmount(cleanPackage, cleanPackage) || 400;

    // Create Razorpay Order
    const orderRes = await createRazorpayOrder({
      amount: numericAmount,
      currency: 'INR',
      receipt: bookingId,
      notes: {
        booking_id: bookingId,
        patient_name: cleanName,
        phone: cleanPhone,
        package: cleanPackage || 'Doctor Consultation'
      }
    });

    if (!orderRes.success) {
      return res.status(500).json({ error: orderRes.error || 'Failed to initialize payment order.' });
    }

    // Format Notes field
    const notesSummary = cleanCondition
      ? `[Focus: ${cleanCondition}] ${cleanNotes}`.trim()
      : (cleanNotes || 'Submitted from REVA Health Website');

    // Construct 17-Column Sheets Row (RAW)
    // appointment_status set to 'SLOT_HOLD' for temporary 15-minute hold
    const sheetsRow = [
      bookingId,
      timestamp,
      cleanName,
      cleanPhone,
      cleanEmail,
      cleanPackage || 'General Consultation',
      numericAmount,
      'PENDING',
      '',
      orderRes.orderId || '',
      cleanDate || timestamp.split('T')[0],
      cleanTime || '',
      'SLOT_HOLD',
      '',
      'LOCAL',
      notesSummary,
      timestamp
    ];

    // Append temporary booking hold to Google Sheets
    let sheetsSuccess = false;
    try {
      const sheetsRes = await appendBooking(sheetsRow);
      sheetsSuccess = sheetsRes.success;
    } catch (e) {
      console.error('Error appending initial booking hold to Sheets:', e.message);
    }

    // 2. Write-Verification Guard for Conflict Resolution
    if (sheetsSuccess && cleanDate && cleanTime) {
      try {
        const { client, sheetId } = getSheetsClient();
        if (client && sheetId) {
          const checkRes = await client.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: 'Bookings!A:Q'
          });

          const rows = checkRes.data.values || [];
          // Scan for matching rows on same date/time
          const matchingRows = [];
          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (r[10] === cleanDate && r[11] === cleanTime && (r[12] === 'SLOT_HOLD' || r[12] === 'PAYMENT_PENDING' || r[12] === 'CONFIRMED')) {
              matchingRows.push({ rowIndex: i + 1, bookingId: r[0], timestamp: r[1] });
            }
          }

          // If multiple holds exist for same slot, earlier timestamp wins
          if (matchingRows.length > 1) {
            matchingRows.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            const winnerBookingId = matchingRows[0].bookingId;

            if (winnerBookingId !== bookingId) {
              // Current booking lost race condition -> mark SLOT_CONFLICT_CANCELLED
              await updateBookingPaymentStatus(bookingId, 'CANCELLED', '', '', 'SLOT_CONFLICT_CANCELLED');
              return res.status(409).json({
                error: 'Slot was reserved by another patient right before request completed. Please select a different time.',
                conflict: true
              });
            }
          }
        }
      } catch (checkErr) {
        console.warn('Write-verification guard check warning:', checkErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      bookingId: bookingId,
      orderId: orderRes.orderId,
      keyId: orderRes.keyId,
      amount: orderRes.amount,
      currency: orderRes.currency,
      sheetsRecorded: sheetsSuccess
    });

  } catch (err) {
    console.error('Error in /api/create-order handler:', err.message || err);
    return res.status(500).json({ error: 'Failed to create booking order.' });
  }
};
