/**
 * Serverless API Endpoint: Send Meeting Link via Email
 * Route: POST /api/admin/send-meet
 */

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
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, error: 'UNAUTHORIZED' };
  }

  if (adminEmail) {
    const providedEmail = req.headers['x-admin-email'];
    if (!providedEmail || providedEmail.toLowerCase().trim() !== adminEmail.toLowerCase().trim()) {
      return { valid: false, error: 'UNAUTHORIZED' };
    }
  }

  return { valid: true };
}

module.exports = async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const rateCheck = checkRateLimit(req, res, 20, 60 * 1000);
  if (rateCheck.limited) {
    return res.status(429).json({ error: `Too many requests. Wait ${rateCheck.resetInSec}s.` });
  }

  const auth = verifyAdminAuth(req);
  if (!auth.valid) return res.status(401).json({ error: auth.error });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { bookingId, meetingLink } = body;

    if (!bookingId || !meetingLink) {
      return res.status(400).json({ error: 'bookingId and meetingLink are required' });
    }

    const { bookings } = await getAllBookings();
    const row = bookings.find(b => b.booking_id === bookingId);
    
    if (!row) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (!row.email) {
      return res.status(400).json({ error: 'Patient does not have an email address on file' });
    }

    const emailRes = await sendBookingConfirmationEmail({
      to: row.email,
      patientName: row.patient_name || 'N/A',
      bookingId: bookingId,
      packageName: row.service_name || 'Doctor Consultation',
      date: row.appointment_date,
      time: row.appointment_time,
      meetingLink: meetingLink
    });

    if (emailRes.success) {
      return res.status(200).json({ success: true, message: 'Email sent successfully!' });
    } else {
      return res.status(500).json({ error: 'Failed to send email. Check logs.' });
    }

  } catch (err) {
    console.error('Error in send-meet:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
