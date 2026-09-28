/**
 * REVA Health — Shared Booking Confirmation Logic
 *
 * Used by both api/verify-payment.js (browser callback path) and
 * api/webhook-razorpay.js (async server-to-server path) to guarantee
 * identical idempotency, conflict detection, calendar creation, and
 * status-update behaviour regardless of which path fires first.
 *
 * Flow (per call):
 *  1. Re-read booking row from Sheets (fresh read — mitigates verify+webhook race).
 *  2. Guard: if booking is already in a terminal state (CONFIRMED, PAID_SLOT_CONFLICT,
 *     SLOT_CONFLICT_CANCELLED, SLOT_EXPIRED), return early without touching anything.
 *  3. Guard: if calendar_event_id is already set, skip calendar creation (prevents
 *     duplicate events when verify-payment and webhook both pass idempotency check
 *     within the same millisecond window).
 *  4. Slot conflict check: if any OTHER booking for the same date/time is CONFIRMED,
 *     → mark this booking PAID_SLOT_CONFLICT, fire Telegram refund alert, return conflict result.
 *  5. Also treat an active SLOT_HOLD or PAYMENT_PENDING by another booking as a conflict
 *     (catches webhook arriving when a newer hold is in-flight for same slot).
 *  6. Create Google Calendar event.
 *     - CONFIRMED  if event created successfully.
 *     - CONFIRMATION_PENDING if calendar fails (booking never lost — admin retry).
 *  7. Update Bookings tab + dispatch Telegram success alert.
 *
 * @param {object} opts
 * @param {string} opts.bookingId
 * @param {string} opts.razorpayPaymentId
 * @param {string} opts.razorpayOrderId
 * @param {string} opts.date            YYYY-MM-DD
 * @param {string} opts.time            e.g. "10:00 AM"
 * @param {string} [opts.name]
 * @param {string} [opts.phone]
 * @param {string} [opts.email]
 * @param {string} [opts.packageName]
 * @param {number} [opts.amount]        authoritative paise amount
 * @param {string} [opts.calendarIdOverride]
 * @param {string} [opts.source]        'verify-payment' | 'webhook'
 *
 * @returns {Promise<{
 *   outcome: 'confirmed'|'confirmation_pending'|'conflict'|'already_terminal'|'error',
 *   appointmentStatus: string,
 *   meetingLink: string,
 *   calendarEventCreated: boolean,
 *   reason?: string
 * }>}
 */

const https = require('https');
const { createAppointmentEvent } = require('./calendar');
const {
  getSheetsClient,
  getAllBookings,
  updateBookingPaymentStatus,
  updateBookingCalendarDetails,
  updateBookingTelegramStatus
} = require('./sheets');

// Statuses that are final — no further modification allowed
const TERMINAL_STATUSES = new Set([
  'CONFIRMED',
  'PAID_SLOT_CONFLICT',
  'SLOT_CONFLICT_CANCELLED',
  'SLOT_EXPIRED'
]);

/**
 * Sends a Telegram message. Silently swallows errors.
 */
async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId || token.includes('your_') || token.includes('temporary_') || chatId.includes('your_')) return;

  const data = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  };

  await new Promise((resolve) => {
    const req = https.request(options, () => resolve());
    req.on('error', (e) => { console.error('[confirm-booking] Telegram error:', e.message); resolve(); });
    req.write(data);
    req.end();
  });
}

/**
 * Parses a "H:MM AM/PM" string into IST ISO start/end strings.
 */
function parseSlotToISO(dateStr, timeStr, durationMin = 30) {
  let startIso = `${dateStr}T10:00:00+05:30`;
  let endIso   = `${dateStr}T10:30:00+05:30`;
  if (timeStr && timeStr.includes(':')) {
    const m = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (m) {
      let h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const ampm = m[3] ? m[3].toUpperCase() : '';
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      const hStr  = String(h).padStart(2, '0');
      const mStr  = String(min).padStart(2, '0');
      const endH  = h + Math.floor((min + durationMin) / 60);
      const endM  = (min + durationMin) % 60;
      startIso = `${dateStr}T${hStr}:${mStr}:00+05:30`;
      endIso   = `${dateStr}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00+05:30`;
    }
  }
  return { startIso, endIso };
}

async function confirmBooking({
  bookingId,
  razorpayPaymentId,
  razorpayOrderId,
  date,
  time,
  name,
  phone,
  email,
  packageName,
  amount,
  calendarIdOverride,
  source = 'unknown'
}) {
  const tag = `[confirm-booking/${source}] booking=${bookingId}`;

  // ── Step 1: Fresh read of the booking row ────────────────────────────────
  let bookingRow = null;
  try {
    const { bookings } = await getAllBookings();
    bookingRow = (bookings || []).find(b => b.booking_id === bookingId);
  } catch (e) {
    console.warn(`${tag} Could not read booking row:`, e.message);
  }

  // ── Step 2: Terminal-state guard ─────────────────────────────────────────
  // Never overwrite CONFIRMED, PAID_SLOT_CONFLICT, SLOT_CONFLICT_CANCELLED, SLOT_EXPIRED
  if (bookingRow && TERMINAL_STATUSES.has(bookingRow.appointment_status)) {
    console.log(`${tag} Already in terminal state "${bookingRow.appointment_status}" — skipping.`);
    return {
      outcome: 'already_terminal',
      appointmentStatus: bookingRow.appointment_status,
      meetingLink: '',
      calendarEventCreated: false,
      reason: `booking already in ${bookingRow.appointment_status}`
    };
  }

  // ── Step 3: Calendar-event-already-created guard ─────────────────────────
  const existingCalEventId = bookingRow ? bookingRow.calendar_event_id : '';

  // ── Step 4 & 5: Slot conflict check ─────────────────────────────────────
  // Re-read Bookings directly from Sheets for freshest possible view.
  const cleanDate = date || (new Date().toISOString().split('T')[0]);
  const cleanTime = time || '';
  const holdExpiryMin = parseInt(process.env.HOLD_EXPIRY_MINUTES || '15', 10);
  const nowMs = Date.now();

  let conflict = false;
  let conflictReason = '';

  if (cleanDate && cleanTime) {
    try {
      const { client, sheetId } = getSheetsClient();
      if (client && sheetId) {
        const checkRes = await client.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Bookings!A:Q' });
        const rows = checkRes.data.values || [];
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (r[0] === bookingId) continue; // Skip own row
          if (r[10] !== cleanDate || r[11] !== cleanTime) continue;

          const status = r[12] || '';
          if (status === 'CONFIRMED') {
            conflict = true;
            conflictReason = `slot CONFIRMED by booking ${r[0]}`;
            break;
          }
          // Also treat active (non-expired) SLOT_HOLD / PAYMENT_PENDING from another booking as a conflict
          if (status === 'SLOT_HOLD' || status === 'PAYMENT_PENDING') {
            const updatedMs = new Date(r[16] || r[1]).getTime();
            const holdExpired = updatedMs && (nowMs - updatedMs > holdExpiryMin * 60 * 1000);
            if (!holdExpired) {
              conflict = true;
              conflictReason = `slot has active ${status} hold by booking ${r[0]}`;
              break;
            }
          }
        }
      }
    } catch (e) {
      // Fail-open: if we can't read Sheets, proceed cautiously without blocking payment
      console.warn(`${tag} Slot conflict check failed (fail-open, proceeding):`, e.message);
    }
  }

  if (conflict) {
    console.log(`${tag} Slot conflict detected — ${conflictReason}`);
    try {
      await updateBookingPaymentStatus(bookingId, 'PAID', razorpayPaymentId, razorpayOrderId || '', 'PAID_SLOT_CONFLICT');
    } catch (e) {
      console.error(`${tag} Failed to mark PAID_SLOT_CONFLICT:`, e.message);
    }

    const bookingName  = name || (bookingRow && bookingRow.patient_name) || 'N/A';
    const bookingPhone = phone || (bookingRow && bookingRow.phone_number) || 'N/A';
    const bookingAmt   = amount || (bookingRow && bookingRow.amount) || 400;

    await sendTelegramMessage(
      `⚠️ <b>[ACTION REQUIRED: SLOT CONFLICT REFUND]</b>\n` +
      `Payment captured but slot already taken!\n\n` +
      `Booking ID: ${bookingId}\n` +
      `Patient: ${bookingName}\nPhone: ${bookingPhone}\n` +
      `Date &amp; Time: ${cleanDate} at ${cleanTime}\n` +
      `Razorpay Payment ID: <code>${razorpayPaymentId}</code>\n` +
      `Amount: \u20B9${bookingAmt}\n` +
      `Conflict: ${conflictReason}\n` +
      `Source: ${source}\n\n` +
      `<i>Please verify Razorpay dashboard and issue manual refund.</i>`
    );

    return {
      outcome: 'conflict',
      appointmentStatus: 'PAID_SLOT_CONFLICT',
      meetingLink: '',
      calendarEventCreated: false,
      reason: conflictReason
    };
  }

  // ── Step 6: Create Google Calendar Event ─────────────────────────────────
  let calRes = { success: false, meetingLink: '', eventId: '' };

  if (existingCalEventId) {
    // Calendar event already exists (e.g. verify-payment already ran) — skip creation, treat as success
    console.log(`${tag} Calendar event already exists (${existingCalEventId}) — skipping creation.`);
    calRes = { success: true, eventId: existingCalEventId, meetingLink: '' };
  } else {
    const { startIso, endIso } = parseSlotToISO(cleanDate, cleanTime);
    try {
      calRes = await createAppointmentEvent({
        calendarIdOverride,
        summary:     `REVA Health Consultation: ${name || 'Patient'}`,
        description: `Confirmed Medical Consultation\nBooking ID: ${bookingId}\nPatient: ${name}\nPhone: ${phone}\nEmail: ${email}`,
        startIso,
        endIso,
        patientName:  name,
        patientEmail: email,
        patientPhone: phone,
        bookingId
      });
    } catch (e) {
      console.error(`${tag} Calendar event creation error:`, e.message);
    }
  }

  const finalApptStatus = calRes.success ? 'CONFIRMED' : 'CONFIRMATION_PENDING';

  // ── Step 7: Update Bookings tab ──────────────────────────────────────────
  let bookingUpdateSuccess = false;
  try {
    const updateRes = await updateBookingPaymentStatus(bookingId, 'PAID', razorpayPaymentId, razorpayOrderId || '', finalApptStatus);
    bookingUpdateSuccess = updateRes.success;
    if (calRes.success && calRes.eventId && !existingCalEventId) {
      await updateBookingCalendarDetails(bookingId, calRes.eventId, finalApptStatus);
    }
  } catch (e) {
    console.error(`${tag} Failed to update booking status:`, e.message);
  }

  // ── Step 8: Telegram success alert ───────────────────────────────────────
  const calStatusTag = calRes.success
    ? 'CONFIRMED'
    : '[ACTION REQUIRED] CONFIRMATION_PENDING (Calendar Sync Failed)';

  const telegramText =
    `REVA HEALTH PAYMENT RECEIVED (${bookingId})\n\n` +
    `Patient: ${name || 'N/A'}\nPhone: ${phone || 'N/A'}\n` +
    `Package: ${packageName || 'Doctor Consultation'}\n` +
    `Amount Paid: \u20B9${(amount || 400)}\n` +
    `Payment ID: ${razorpayPaymentId}\n` +
    `Date &amp; Time: ${cleanDate} at ${cleanTime}\n` +
    `Google Meet Link: ${calRes.meetingLink || 'Scheduled / Sync Pending'}\n` +
    `Source: ${source}\n\n` +
    `Status: ${calStatusTag}`;

  await sendTelegramMessage(telegramText).catch(() => {});

  // Update telegram_status in Sheets (best effort)
  updateBookingTelegramStatus(bookingId, 'SENT').catch(() => {});

  console.log(`${tag} Completed — appointmentStatus=${finalApptStatus} calendarEventCreated=${calRes.success}`);

  return {
    outcome: calRes.success ? 'confirmed' : 'confirmation_pending',
    appointmentStatus: finalApptStatus,
    meetingLink:        calRes.meetingLink || '',
    calendarEventCreated: calRes.success,
    bookingUpdated:     bookingUpdateSuccess
  };
}

module.exports = { confirmBooking, TERMINAL_STATUSES };
