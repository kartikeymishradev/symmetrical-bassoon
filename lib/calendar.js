/**
 * REVA Health — Google Calendar Service Layer
 *
 * Integrates with Google Calendar API (v3) using official googleapis SDK.
 * Manages doctor availability, slot queries, event creation (with optional Google Meet links),
 * and event rescheduling/cancellations.
 */

const { google } = require('googleapis');

/**
 * Gets Google Calendar API v3 client using shared service account credentials.
 */
function getCalendarClient() {
  const { clientEmail, privateKey } = getServiceAccountCredentials();
  if (!clientEmail || !privateKey) {
    return { client: null, error: 'Google Service Account credentials unconfigured.' };
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey
      },
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events'
      ]
    });

    const calendar = google.calendar({ version: 'v3', auth });
    return { client: calendar, error: null };
  } catch (err) {
    return { client: null, error: err.message };
  }
}

function getServiceAccountCredentials() {
  const clientEmail = (process.env.GOOGLE_CALENDAR_CLIENT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim().replace(/^["']|["']$/g, '');
  const rawPrivateKey = process.env.GOOGLE_CALENDAR_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';
  const privateKey = rawPrivateKey
    ? rawPrivateKey.replace(/^["']([\s\S]*)["']$/, '$1').replace(/\\n/g, '\n').trim()
    : '';
  return { clientEmail, privateKey };
}

function parseTimeHHMM(timeStr, defaultStr) {
  if (typeof timeStr !== 'string') {
    return parseTimeHHMM(defaultStr, '00:00');
  }
  const parts = timeStr.trim().split(':');
  if (parts.length !== 2) {
    console.warn(`[Config Warning] Invalid time format "${timeStr}". Expected HH:MM. Using default "${defaultStr}".`);
    return parseTimeHHMM(defaultStr, '00:00');
  }
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    console.warn(`[Config Warning] Invalid time values in "${timeStr}". Using default "${defaultStr}".`);
    return parseTimeHHMM(defaultStr, '00:00');
  }
  return {
    hour: h,
    minute: m,
    str: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    totalMinutes: h * 60 + m
  };
}

function getWorkingHoursConfig() {
  const startRaw = process.env.WORK_START_TIME;
  const endRaw = process.env.WORK_END_TIME;

  let startTime = parseTimeHHMM(startRaw, '08:00');
  let endTime = parseTimeHHMM(endRaw, '22:30');

  if (endTime.totalMinutes <= startTime.totalMinutes) {
    console.warn(`[Config Warning] WORK_END_TIME (${endTime.str}) must be greater than WORK_START_TIME (${startTime.str}). Falling back to defaults 08:00 - 22:30.`);
    startTime = parseTimeHHMM('08:00', '08:00');
    endTime = parseTimeHHMM('22:30', '22:30');
  }

  let durationMin = parseInt(process.env.SLOT_DURATION_MIN || '30', 10);
  if (isNaN(durationMin) || durationMin <= 0) {
    console.warn(`[Config Warning] Invalid SLOT_DURATION_MIN "${process.env.SLOT_DURATION_MIN}". Falling back to default 30.`);
    durationMin = 30;
  }

  let leadMin = parseInt(process.env.MIN_BOOKING_LEAD_MINUTES || '60', 10);
  if (isNaN(leadMin) || leadMin < 0) {
    console.warn(`[Config Warning] Invalid MIN_BOOKING_LEAD_MINUTES "${process.env.MIN_BOOKING_LEAD_MINUTES}". Falling back to default 60.`);
    leadMin = 60;
  }

  let holdExpiryMin = parseInt(process.env.HOLD_EXPIRY_MINUTES || '15', 10);
  if (isNaN(holdExpiryMin) || holdExpiryMin <= 0) {
    console.warn(`[Config Warning] Invalid HOLD_EXPIRY_MINUTES "${process.env.HOLD_EXPIRY_MINUTES}". Falling back to default 15.`);
    holdExpiryMin = 15;
  }

  return {
    startTime,
    endTime,
    durationMin,
    leadMin,
    holdExpiryMin
  };
}

function formatTime12h(date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  return formatter.format(date);
}

function formatTime24h(date) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return formatter.format(date);
}

function generateSlotsFromConfig(dateStr, durationMinutesOverride, additionalBusySlots = [], busyRanges = []) {
  const config = getWorkingHoursConfig();
  const durationMin = (typeof durationMinutesOverride === 'number' && !isNaN(durationMinutesOverride) && durationMinutesOverride > 0)
    ? durationMinutesOverride
    : config.durationMin;

  const timeMin = new Date(`${dateStr}T${config.startTime.str}:00+05:30`);
  const timeMax = new Date(`${dateStr}T${config.endTime.str}:00+05:30`);

  const now = new Date();
  const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  const leadCutoffMs = now.getTime() + config.leadMin * 60 * 1000;

  const combinedBusy = [...busyRanges];
  additionalBusySlots.forEach(b => {
    if (b.startIso && b.endIso) {
      combinedBusy.push({ start: b.startIso, end: b.endIso });
    }
  });

  const availableSlots = [];
  let currentSlotStart = new Date(timeMin);

  while (currentSlotStart.getTime() + durationMin * 60 * 1000 <= timeMax.getTime()) {
    const currentSlotEnd = new Date(currentSlotStart.getTime() + durationMin * 60 * 1000);

    // Filter out past slots or slots within MIN_BOOKING_LEAD_MINUTES if target date is today or earlier
    const isTooSoon = (dateStr <= todayIST) && (currentSlotStart.getTime() < leadCutoffMs);

    const isBusy = combinedBusy.some(busy => {
      const busyStart = new Date(busy.startIso || busy.start).getTime();
      const busyEnd = new Date(busy.endIso || busy.end).getTime();
      return (currentSlotStart.getTime() < busyEnd && currentSlotEnd.getTime() > busyStart);
    });

    if (!isTooSoon && !isBusy) {
      availableSlots.push({
        time12h: formatTime12h(currentSlotStart),
        startIso: currentSlotStart.toISOString(),
        endIso: currentSlotEnd.toISOString(),
        slotStart: formatTime24h(currentSlotStart)
      });
    }

    currentSlotStart = new Date(currentSlotStart.getTime() + durationMin * 60 * 1000);
  }

  return availableSlots;
}

/**
 * Returns available time slots for a target date (YYYY-MM-DD) by querying Google Calendar freebusy API.
 */
async function getAvailableSlots(calendarIdOverride, dateStr, durationMinutes, additionalBusySlots = []) {
  const calendarId = calendarIdOverride || process.env.GOOGLE_CALENDAR_ID || 'primary';
  const { client, error } = getCalendarClient();
  const config = getWorkingHoursConfig();
  const durMin = (typeof durationMinutes === 'number' && !isNaN(durationMinutes) && durationMinutes > 0)
    ? durationMinutes
    : config.durationMin;

  if (error || !client) {
    console.warn('Google Calendar unconfigured; returning standard working slots fallback:', error);
    return {
      success: true,
      source: 'standard_fallback',
      slots: generateStandardDaySlots(dateStr, durMin, additionalBusySlots)
    };
  }

  try {
    const timeMin = new Date(`${dateStr}T${config.startTime.str}:00+05:30`);
    const timeMax = new Date(`${dateStr}T${config.endTime.str}:00+05:30`);

    const freeBusyRes = await client.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: calendarId }]
      }
    });

    const busyRanges = (freeBusyRes.data.calendars[calendarId] || {}).busy || [];
    const slots = generateSlotsFromConfig(dateStr, durMin, additionalBusySlots, busyRanges);

    return { success: true, source: 'google_calendar', slots };

  } catch (err) {
    console.error('Error fetching Google Calendar slots:', err.message);
    return {
      success: true,
      source: 'fallback_error',
      slots: generateStandardDaySlots(dateStr, durMin, additionalBusySlots)
    };
  }
}

function generateStandardDaySlots(dateStr, durationMinutes, additionalBusySlots = []) {
  return generateSlotsFromConfig(dateStr, durationMinutes, additionalBusySlots, []);
}

/**
 * Creates a Google Calendar Event for a confirmed consultation appointment AFTER payment is verified.
 * Google Meet link is optional depending on GOOGLE_MEET_ENABLED environment variable.
 */
async function createAppointmentEvent({ calendarIdOverride, summary, description, startIso, endIso, patientName, patientEmail, patientPhone, bookingId }) {
  const calendarId = calendarIdOverride || process.env.GOOGLE_CALENDAR_ID || 'primary';
  const { client, error } = getCalendarClient();

  if (error || !client) {
    console.warn('Google Calendar unconfigured; skipping live event creation.');
    return { success: false, reason: error || 'unconfigured' };
  }

  const isMeetEnabled = (process.env.GOOGLE_MEET_ENABLED || 'true').toLowerCase() !== 'false';

  // Base32v requires a-v, 0-9. Booking ID is ENQ-XXX. We sanitize to make it a deterministic event ID.
  const deterministicEventId = bookingId ? `reva${bookingId.toLowerCase().replace(/[^a-v0-9]/g, '')}` : undefined;

  try {
    const eventBody = {
      id: deterministicEventId,
      summary: summary || `REVA Health Consultation - ${patientName}`,
      description: description || `Patient Consultation Booking (${bookingId})\nName: ${patientName}\nPhone: ${patientPhone}\nEmail: ${patientEmail}`,
      start: { dateTime: startIso, timeZone: 'Asia/Kolkata' },
      end: { dateTime: endIso, timeZone: 'Asia/Kolkata' },
      attendees: patientEmail ? [{ email: patientEmail, displayName: patientName }] : [],
      extendedProperties: {
        shared: {
          bookingId: bookingId || '',
          patientPhone: patientPhone || '',
          source: 'REVA_HEALTH_WEBSITE'
        }
      }
    };

    if (isMeetEnabled) {
      eventBody.conferenceData = {
        createRequest: {
          requestId: `meet-${bookingId || Date.now()}`,
          conferenceSolutionKey: { type: 'eventHangout' }
        }
      };
    }

    let res;
    try {
      res = await client.events.insert({
        calendarId: calendarId,
        requestBody: eventBody,
        conferenceDataVersion: isMeetEnabled ? 1 : 0
      });
    } catch (insertErr) {
      if (insertErr.code === 409) {
        console.log(`[Calendar] Event already exists (409) for booking ${bookingId}. Treating as successful creation.`);
        return { success: true, eventId: deterministicEventId, meetingLink: 'already_created' };
      }
      // Fallback: Remove attendees and conferenceData if service account lacks DWD / conference permissions
      delete eventBody.attendees;
      delete eventBody.conferenceData;
      try {
        res = await client.events.insert({
          calendarId: calendarId,
          requestBody: eventBody,
          conferenceDataVersion: 0
        });
      } catch (fallbackErr) {
        if (fallbackErr.code === 409) {
          console.log(`[Calendar] Event already exists on fallback (409) for booking ${bookingId}.`);
          return { success: true, eventId: deterministicEventId, meetingLink: 'already_created' };
        }
        throw fallbackErr;
      }
    }

    const event = res.data;
    const meetingLink = event.hangoutLink || (event.conferenceData && event.conferenceData.entryPoints ? event.conferenceData.entryPoints[0].uri : '');

    return {
      success: true,
      eventId: event.id,
      htmlLink: event.htmlLink,
      meetingLink: meetingLink
    };

  } catch (err) {
    console.error('Google Calendar event creation error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Deletes a Google Calendar Event by ID (used for test event cleanup).
 */
async function deleteCalendarEvent(eventId, calendarIdOverride) {
  const calendarId = calendarIdOverride || process.env.GOOGLE_CALENDAR_ID || 'primary';
  const { client, error } = getCalendarClient();

  if (error || !client || !eventId) {
    return { success: false, error: error || 'Invalid eventId or client' };
  }

  try {
    await client.events.delete({
      calendarId: calendarId,
      eventId: eventId
    });
    return { success: true };
  } catch (err) {
    console.error('Error deleting Google Calendar event:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  getCalendarClient,
  getAvailableSlots,
  generateStandardDaySlots,
  createAppointmentEvent,
  deleteCalendarEvent,
  formatTime12h,
  formatTime24h
};
