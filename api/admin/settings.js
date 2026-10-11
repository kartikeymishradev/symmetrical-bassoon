const { getSettings, fetchServices, updateServicePrice, saveSettingsToSheets } = require('../../lib/sheets');
const { setCorsHeaders } = require('../../lib/cors');
const { checkRateLimit } = require('../../lib/ratelimit');
const crypto = require('crypto');

function verifyAdminAuth(req) {
  const secretKey = process.env.ADMIN_SECRET_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!secretKey) return { valid: false, error: 'ADMIN_SECRET_KEY_NOT_SET' };
  const providedSecret = req.headers['x-admin-secret'];
  if (!providedSecret || typeof providedSecret !== 'string') return { valid: false, error: 'UNAUTHORIZED' };
  const expectedBuf = Buffer.from(secretKey, 'utf8');
  const actualBuf = Buffer.from(providedSecret, 'utf8');
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) return { valid: false, error: 'UNAUTHORIZED' };
  if (adminEmail) {
    const providedEmail = req.headers['x-admin-email'];
    if (!providedEmail || providedEmail.toLowerCase().trim() !== adminEmail.toLowerCase().trim()) return { valid: false, error: 'UNAUTHORIZED' };
  }
  return { valid: true };
}

module.exports = async (req, res) => {
  setCorsHeaders(req, res, { isAdmin: true });
  if (req.method === 'OPTIONS') return res.status(200).end();
  const rateCheck = checkRateLimit(req, res, 20, 60 * 1000);
  if (rateCheck.limited) return res.status(429).json({ error: 'Too many requests.' });
  const auth = verifyAdminAuth(req);
  if (!auth.valid) return res.status(401).json({ error: auth.error });

  try {
    if (req.method === 'GET') {
      const [settingsRes, servicesRes] = await Promise.all([ getSettings(), fetchServices() ]);
      const mappedServices = (servicesRes.services || []).map(s => ({
        service_id: s.service_id, service_name: s.service_name, price: s.amount, active: s.active
      }));
      return res.status(200).json({ success: true, settings: settingsRes.settings || {}, services: mappedServices });
    }
    
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { action, serviceId, newPrice, start_time, end_time, working_days, lead_time_hours } = body;
      if (action === 'update_price') {
        const price = parseFloat(newPrice);
        if (!serviceId || isNaN(price) || price < 0 || price > 100000) return res.status(400).json({ error: 'Invalid price' });
        const updateRes = await updateServicePrice(serviceId, price);
        return updateRes.success ? res.status(200).json({ success: true }) : res.status(500).json({ error: updateRes.error || 'Failed' });
      }
function normalizeTimeString(t) {
  if (!t || typeof t !== 'string') return null;
  t = t.trim();
  const ampmMatch = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1], 10);
    const m = parseInt(ampmMatch[2] || '0', 10);
    const isPm = ampmMatch[3].toLowerCase() === 'pm';
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }
  const match24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const h = parseInt(match24[1], 10);
    const m = parseInt(match24[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }
  return null;
}

      if (action === 'update_settings') {
        const normStart = normalizeTimeString(start_time);
        const normEnd = normalizeTimeString(end_time);
        if (!normStart || !normEnd) return res.status(400).json({ error: 'Invalid time format. Please use standard time (e.g. 09:00, 18:00, or 9:00 AM, 6:00 PM)' });
        const [startH, startM] = normStart.split(':').map(Number);
        const [endH, endM] = normEnd.split(':').map(Number);
        if ((startH * 60 + startM) >= (endH * 60 + endM)) return res.status(400).json({ error: 'Start time must be before end time.' });
        const validDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const daysArr = String(working_days || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
        const invalidDays = daysArr.filter(d => !validDays.includes(d));
        if (invalidDays.length > 0 || daysArr.length === 0) return res.status(400).json({ error: `Invalid days provided. Use comma-separated short names (mon,tue). Found invalid: ${invalidDays.join(',')}` });
        const leadHrs = parseFloat(lead_time_hours);
        if (isNaN(leadHrs) || leadHrs < 0 || leadHrs > 72) return res.status(400).json({ error: 'Invalid lead time. Must be a number between 0 and 72 hours.' });
        const updateRes = await saveSettingsToSheets({ start_time: normStart, end_time: normEnd, working_days, lead_time_hours });
        return updateRes.success ? res.status(200).json({ success: true }) : res.status(500).json({ error: updateRes.error || 'Failed' });
      }
      return res.status(400).json({ error: 'Invalid action.' });
    }
  } catch (err) { return res.status(500).json({ error: 'Internal server error' }); }
};
