/**
 * Serverless API Endpoint: REVA Health Available Time Slots
 * Route: GET /api/slots?date=YYYY-MM-DD
 *
 * Combines Google Calendar freebusy queries with active temporary slot holds in Google Sheets
 * to calculate and return available 30-minute consultation time slots for the requested date.
 * Excludes held slots (<15 min old) to prevent double booking.
 */

const { getAvailableSlots } = require('../lib/calendar');
const { fetchActiveSlotHolds } = require('../lib/sheets');
const { setCorsHeaders } = require('../lib/cors');

module.exports = async function handler(req, res) {
  // Dynamic CORS Headers
  setCorsHeaders(req, res, { methods: 'GET, OPTIONS' });

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const dateStr = url.searchParams.get('date') || new Date().toISOString().split('T')[0];

    const validator = require('../lib/validator');
    // Validate YYYY-MM-DD format and booking window logic
    if (!validator.isValidDate(dateStr)) {
      return res.status(400).json({ error: 'Invalid date format or outside allowed booking window.' });
    }

    // 1. Fetch active temporary slot holds from Google Sheets
    const sheetsBusySlots = await fetchActiveSlotHolds(dateStr);

    // 2. Query Google Calendar freebusy merged with Sheets active holds
    const { success, source, slots, error } = await getAvailableSlots(null, dateStr, 30, sheetsBusySlots);

    return res.status(200).json({
      success: true,
      date: dateStr,
      source: source || 'calendar',
      count: slots ? slots.length : 0,
      slots: slots || []
    });

  } catch (err) {
    console.error('Error in /api/slots handler:', err.message || err);
    return res.status(500).json({ error: 'Failed to fetch available time slots.' });
  }
};
