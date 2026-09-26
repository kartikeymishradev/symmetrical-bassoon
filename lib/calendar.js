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

const WORK_START_HOUR = parseInt(process.env.WORK_START_HOUR || '8', 10);
const WORK_START_MINUTE = parseInt(process.env.WORK_START_MINUTE || '0', 10);
const WORK_END_HOUR = parseInt(process.env.WORK_END_HOUR || '22', 10);
const WORK_END_MINUTE = parseInt(process.env.WORK_END_MINUTE || '30', 10);
const DEFAULT_SLOT_DURATION_MIN = 30;

function formatTime12h(date) {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minStr = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minStr} ${ampm}`;
}

/**
 * Returns available time slots for a target date (YYYY-MM-DD) by querying Google Calendar freebusy API.
 */
async function getAvailableSlots(calendarIdOverride, dateStr, durationMinutes = DEFAULT_SLOT_DURATION_MIN, additionalBusySlots = []) {
  const calendarId = calendarIdOverride || process.env.GOOGLE_CALENDAR_ID || 'primary';
  const { client, error } = getCalendarClient();

  if (error || !client) {
    console.warn('Google Calendar unconfigured; returning standard working slots fallback:', error);
    return { success: true, source: 'standard_fallback', slots: generateStandardDaySlots(dateStr, durationMinutes, additionalBusySlots) };
  }

  try {
    const startStr = String(WORK_START_HOUR).padStart(2, '0');
    const startMinStr = String(WORK_START_MINUTE).padStart(2, '0');
    const endStr = String(WORK_END_HOUR).padStart(2, '0');
    const endMinStr = String(WORK_END_MINUTE).padStart(2, '0');

    const timeMin = new Date(`${dateStr}T${startStr}:${startMinStr}:00+05:30`);
    const timeMax = new Date(`${dateStr}T${endStr}:${endMinStr}:00+05:30`);

    const freeBusyRes = await client.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: calendarId }]
      }
    });

    const busyRanges = (freeBusyRes.data.calendars[calendarId] || {}).busy || [];

    // Combine with additional busy ranges (e.g. active slot holds in Sheets)
    additionalBusySlots.forEach(b => {
      if (b.startIso && b.endIso) {
        busyRanges.push({ start: b.startIso, end: b.endIso });
      }
    });

    const availableSlots = [];
    let currentSlotStart = new Date(timeMin);

    while (currentSlotStart.getTime() + durationMinutes * 60 * 1000 <= timeMax.getTime()) {
      const currentSlotEnd = new Date(currentSlotStart.getTime() + durationMinutes * 60 * 1000);

      const isBusy = busyRanges.some(busy => {
        const busyStart = new Date(busy.start).getTime();
        const busyEnd = new Date(busy.end).getTime();
        return (currentSlotStart.getTime() < busyEnd && currentSlotEnd.getTime() > busyStart);
      });

      if (!isBusy) {
        availableSlots.push({
          time12h: formatTime12h(currentSlotStart),
          startIso: currentSlotStart.toISOString(),
          endIso: currentSlotEnd.toISOString(),
          slotStart: currentSlotStart.toTimeString().substring(0, 5)
        });
      }

      currentSlotStart = new Date(currentSlotStart.getTime() + durationMinutes * 60 * 1000);
    }

    return { success: true, source: 'google_calendar', slots: availableSlots };

  } catch (err) {
    console.error('Error fetching Google Calendar slots:', err.message);
    return { success: true, source: 'fallback_error', slots: generateStandardDaySlots(dateStr, durationMinutes, additionalBusySlots) };
  }
}

function generateStandardDaySlots(dateStr, durationMinutes = 30, additionalBusySlots = []) {
  const slots = [];
  const startStr = String(WORK_START_HOUR).padStart(2, '0');
  const startMinStr = String(WORK_START_MINUTE).padStart(2, '0');
  const endStr = String(WORK_END_HOUR).padStart(2, '0');
  const endMinStr = String(WORK_END_MINUTE).padStart(2, '0');

  const start = new Date(`${dateStr}T${startStr}:${startMinStr}:00+05:30`);
  const end = new Date(`${dateStr}T${endStr}:${endMinStr}:00+05:30`);
  let current = new Date(start);

  while (current.getTime() + durationMinutes * 60 * 1000 <= end.getTime()) {
    const slotEnd = new Date(current.getTime() + durationMinutes * 60 * 1000);
    
    const isBusy = additionalBusySlots.some(b => {
      if (!b.startIso || !b.endIso) return false;
      const bStart = new Date(b.startIso).getTime();
      const bEnd = new Date(b.endIso).getTime();
      return (current.getTime() < bEnd && slotEnd.getTime() > bStart);
    });

    if (!isBusy) {
      slots.push({
        time12h: formatTime12h(current),
        startIso: current.toISOString(),
        endIso: slotEnd.toISOString(),
        slotStart: current.toTimeString().substring(0, 5)
      });
    }

    current = new Date(current.getTime() + durationMinutes * 60 * 1000);
  }
  return slots;
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

  try {
    const eventBody = {
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
      // Fallback: Remove attendees and conferenceData if service account lacks DWD / conference permissions
      delete eventBody.attendees;
      delete eventBody.conferenceData;
      res = await client.events.insert({
        calendarId: calendarId,
        requestBody: eventBody,
        conferenceDataVersion: 0
      });
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
  createAppointmentEvent,
  deleteCalendarEvent,
  formatTime12h
};
