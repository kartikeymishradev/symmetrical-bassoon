const { getAllBookings } = require('../../lib/sheets');
const { sendBookingConfirmationEmail } = require('../../lib/email');
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
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body.bookingId) return res.status(400).json({ error: 'bookingId is required' });
    const { bookings } = await getAllBookings();
    const row = bookings.find(b => b.booking_id === body.bookingId);
    if (!row) return res.status(404).json({ error: 'Booking not found' });
    if (!row.email) return res.status(400).json({ error: 'Patient does not have an email' });
    const emailRes = await sendBookingConfirmationEmail({
      to: row.email, patientName: row.patient_name || 'Patient', bookingId: body.bookingId,
      packageName: row.service_name || 'Consultation', date: row.appointment_date, time: row.appointment_time, meetingLink: '' 
    });
    return emailRes.success ? res.status(200).json({ success: true }) : res.status(500).json({ error: 'Failed to resend email' });
  } catch(e) { return res.status(500).json({ error: 'Internal server error' }); }
};
