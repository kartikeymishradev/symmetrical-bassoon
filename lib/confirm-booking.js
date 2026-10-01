/**
 * REVA Health — Shared Booking Confirmation Logic
 *
 * Used by both api/verify-payment.js (browser callback path) and
 * api/webhook-razorpay.js (async server-to-server path).
 *
 * Flow per call:
 *  1. Re-read booking row from Sheets (fresh read).
 *  2. Terminal-state guard: never overwrite CONFIRMED / PAID_SLOT_CONFLICT /
 *     SLOT_CONFLICT_CANCELLED / SLOT_EXPIRED.
 *  3. Use authoritative date & time from Sheets row (ignores caller-supplied
 *     values for calendar creation — S9 fix).
 *  4. Slot conflict check (via raw Sheets read for freshest view):
 *     - Another CONFIRMED booking for same slot → PAID_SLOT_CONFLICT
 *     - Another active (non-expired) SLOT_HOLD / PAYMENT_PENDING → PAID_SLOT_CONFLICT
 *  5. Calendar-event dedup: re-read booking row immediately before creating the
 *     calendar event; if calendar_event_id is already set (concurrent call won
 *     the race), skip creation and return existing event data (S6 fix).
 *  6. Create Google Calendar event.
 *  7. Update Bookings tab + dispatch Telegram success alert.
 */

const https = require('https');
const { createAppointmentEvent } = require('./calendar');
const { sendBookingConfirmationEmail } = require('./email');
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
 * Escapes user-supplied strings for safe embedding in Telegram HTML messages.
 * Telegram HTML only supports <b>, <i>, <code>, <pre>, <a> — user data must
 * have < > & escaped to prevent injection / broken markup (S10 fix).
 */
function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sends a Telegram message. Silently swallows errors.
 */
async function sendTelegramMessage(text) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
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
      const hStr = String(h).padStart(2, '0');
      const mStr = String(min).padStart(2, '0');
      const endH = h + Math.floor((min + durationMin) / 60);
      const endM = (min + durationMin) % 60;
      startIso = `${dateStr}T${hStr}:${mStr}:00+05:30`;
      endIso   = `${dateStr}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00+05:30`;
    }
  }
  return { startIso, endIso };
}

/**
 * Reads a single booking row directly from Sheets (raw range read).
 * Returns null if Sheets unconfigured or row not found.
 */
async function readFreshBookingRow(bookingId) {
  try {
    const { client, sheetId } = getSheetsClient();
    if (!client || !sheetId) return null;
    const res = await client.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Bookings!A:Q' });
    const rows = res.data.values || [];
    const r = rows.slice(1).find(r => r[0] === bookingId);
    if (!r) return null;
    return {
      booking_id:           r[0],
      timestamp:            r[1],
      patient_name:         r[2],
      phone_number:         r[3],
      email:                r[4],
      service_name:         r[5],
      amount:               r[6],
      payment_status:       r[7],
      razorpay_payment_id:  r[8],
      razorpay_order_id:    r[9],
      appointment_date:     r[10],
      appointment_time:     r[11],
      appointment_status:   r[12],
      calendar_event_id:    r[13],
      telegram_status:      r[14],
      notes:                r[15],
      updated_at:           r[16]
    };
  } catch (e) {
    return null;
  }
}

// WARNING: IN-MEMORY MUTEX ONLY (SINGLE INSTANCE)
// This _locks map only serializes concurrent calls within the SAME Vercel serverless instance.
// It DOES NOT provide distributed locking across multiple concurrent Vercel workers.
// If the webhook and browser callback hit different Vercel instances simultaneously,
// this lock will NOT prevent race conditions (TOCTOU) against Google Sheets or Calendar.
// A true distributed lock (e.g., Redis/Vercel KV) or a proper database with ACID transactions
// is required for robust concurrency control.
//
// (Legacy doc: Per-bookingId in-process mutex. Serialises concurrent confirmBooking calls for the same
// booking so only one creates the calendar event. Sufficient for serverless (each request
// is a single process) and for test scenarios running Promise.all. (S6 fix)
const _locks = new Map();
function _withLock(key, fn) {
  const prev = _locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn); // run fn even if prev rejected (don't block forever)
  _locks.set(key, next.catch(() => {}));
  return next;
}

async function _confirmBookingImpl({
  bookingId,
  razorpayPaymentId,
  razorpayOrderId,
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

  if (!bookingRow) {
    console.error(`${tag} Booking row not found, cannot confirm.`);
    return { outcome: 'error', reason: 'Booking row not found' };
  }

  // ── Step 2: Terminal-state guard ─────────────────────────────────────────
  if (bookingRow && TERMINAL_STATUSES.has(bookingRow.appointment_status)) {
    console.log(`${tag} Already in terminal state "${bookingRow.appointment_status}" — skipping.`);
    let recoveredMeetingLink = '';
    if (bookingRow.appointment_status === 'CONFIRMED' && bookingRow.calendar_event_id) {
      recoveredMeetingLink = bookingRow.calendar_event_id.startsWith('http') ? bookingRow.calendar_event_id : `https://meet.google.com/${bookingRow.calendar_event_id}`;
    }
    return {
      outcome:              'already_terminal',
      appointmentStatus:    bookingRow.appointment_status,
      meetingLink:          recoveredMeetingLink,
      calendarEventCreated: false,
      reason:               `booking already in ${bookingRow.appointment_status}`
    };
  }

  // ── Step 3: Authoritative slot values from Sheets (S9 fix) ───────────────
  // Always use what was booked in Sheets.
  const cleanDate = bookingRow.appointment_date || (new Date().toISOString().split('T')[0]);
  const cleanTime = bookingRow.appointment_time || '';
  // Authoritative name/phone for Telegram messages (escaped for HTML)
  const authName  = escHtml(bookingRow.patient_name || 'N/A');
  const authPhone = escHtml(bookingRow.phone_number || 'N/A');
  const authAmt   = parseFloat(bookingRow.amount) || 400;

  // ── Step 4 & 5: Slot conflict check (fresh raw Sheets read) ─────────────
  const holdExpiryMin = parseInt(process.env.HOLD_EXPIRY_MINUTES || '15', 10);
  const nowMs = Date.now();
  let conflict = false;
  let conflictReason = '';

  if (cleanDate && cleanTime) {
    try {
      const { client, sheetId } = getSheetsClient();
      if (client && sheetId) {
        const checkRes = await client.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Bookings!A:Q' });
        const allRows = checkRes.data.values || [];
        for (let i = 1; i < allRows.length; i++) {
          const r = allRows[i];
          if (r[0] === bookingId) continue;
          if (r[10] !== cleanDate || r[11] !== cleanTime) continue;

          const status = r[12] || '';
          if (status === 'CONFIRMED') {
            conflict = true;
            conflictReason = `slot CONFIRMED by booking ${r[0]}`;
            break;
          }
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

    await sendTelegramMessage(
      `⚠️ <b>[ACTION REQUIRED: SLOT CONFLICT REFUND]</b>\n` +
      `Payment captured but slot already taken!\n\n` +
      `Booking ID: ${escHtml(bookingId)}\n` +
      `Patient: ${authName}\nPhone: ${authPhone}\n` +
      `Date &amp; Time: ${escHtml(cleanDate)} at ${escHtml(cleanTime)}\n` +
      `Razorpay Payment ID: <code>${escHtml(razorpayPaymentId)}</code>\n` +
      `Amount: \u20B9${authAmt}\n` +
      `Conflict: ${escHtml(conflictReason)}\n` +
      `Source: ${escHtml(source)}\n\n` +
      `<i>Please verify Razorpay dashboard and issue manual refund.</i>`
    );

    return {
      outcome:              'conflict',
      appointmentStatus:    'PAID_SLOT_CONFLICT',
      meetingLink:          '',
      calendarEventCreated: false,
      reason:               conflictReason
    };
  }

  // ── Step 6: Calendar-event dedup guard (re-read row immediately) ─────────
  // Re-read right before creating the calendar event. If a concurrent call
  // (verify-payment + webhook race) already wrote calendar_event_id, we skip
  // creation and use the existing event. (S6 fix)
  const freshRow = await readFreshBookingRow(bookingId);
  const existingCalEventId = freshRow ? freshRow.calendar_event_id : (bookingRow ? bookingRow.calendar_event_id : '');

  // ── Step 7: Create Google Calendar Event ─────────────────────────────────
  let calRes = { success: false, meetingLink: '', eventId: '' };

  if (existingCalEventId) {
    console.log(`${tag} Calendar event already exists (${existingCalEventId}) — skipping creation.`);
    calRes = { success: true, eventId: existingCalEventId, meetingLink: '' };
  } else {
    const { startIso, endIso } = parseSlotToISO(cleanDate, cleanTime);
    try {
        calRes = await createAppointmentEvent({
          summary:      `REVA Health Consultation (${bookingId})`,
          description:  `Confirmed Medical Consultation\nBooking ID: ${bookingId}\nService: ${bookingRow.service_name || "Standard Consultation"}`,
          startIso,
          endIso,
          bookingId
        });
    } catch (e) {
      console.error(`${tag} Calendar event creation error:`, e.message);
    }
  }

  const finalApptStatus = calRes.success ? 'CONFIRMED' : 'CONFIRMATION_PENDING';

  // ── Step 8: Update Bookings tab ──────────────────────────────────────────
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

  // ── Step 9: Telegram success alert ───────────────────────────────────────
  const calStatusTag = calRes.success
    ? 'CONFIRMED'
    : '[ACTION REQUIRED] CONFIRMATION_PENDING (Calendar Sync Failed)';

  await sendTelegramMessage(
    `REVA HEALTH PAYMENT RECEIVED (${escHtml(bookingId)})\n\n` +
    `Patient: ${authName}\nPhone: ${authPhone}\n` +
    `Package: ${escHtml(bookingRow.service_name || 'Doctor Consultation')}\n` +
    `Amount Paid: \u20B9${authAmt}\n` +
    `Payment ID: <code>${escHtml(razorpayPaymentId)}</code>\n` +
    `Date &amp; Time: ${escHtml(cleanDate)} at ${escHtml(cleanTime)}\n` +
    `Google Meet Link: ${calRes.meetingLink || 'Scheduled / Sync Pending'}\n` +
    `Source: ${escHtml(source)}\n\n` +
    `Status: ${calStatusTag}`
  ).catch(() => {});

  updateBookingTelegramStatus(bookingId, 'SENT').catch(() => {});

  console.log(`${tag} Completed — appointmentStatus=${finalApptStatus} calendarEventCreated=${calRes.success}`);

  
  // Fire-and-forget email confirmation
  if (bookingRow && bookingRow.email && calRes.success) {
    sendBookingConfirmationEmail({
      to: bookingRow.email,
      patientName: authName,
      bookingId,
      packageName: bookingRow.service_name || 'Doctor Consultation',
      date: cleanDate,
      time: cleanTime,
      meetingLink: calRes.meetingLink || ''
    });
  }

  return {
    outcome:              calRes.success ? 'confirmed' : 'confirmation_pending',
    appointmentStatus:    finalApptStatus,
    meetingLink:          calRes.meetingLink || '',
    calendarEventCreated: calRes.success,
    bookingUpdated:       bookingUpdateSuccess
  };
}

/**
 * Public entry point — wraps _confirmBookingImpl in a per-bookingId mutex
 * so concurrent calls (verify-payment + webhook race) are serialised.
 */
function confirmBooking(opts) {
  return _withLock(opts.bookingId, () => _confirmBookingImpl(opts));
}

module.exports = { confirmBooking, TERMINAL_STATUSES, escHtml };
