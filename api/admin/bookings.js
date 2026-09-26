/**
 * Serverless API Endpoint: REVA Health Admin Dashboard & Operations API
 * Route: /api/admin/bookings
 *
 * 1. Admin Authentication via x-admin-secret header or secret query parameter.
 * 2. GET: Returns all bookings and payments from Google Sheets.
 * 3. POST action="retry_calendar_sync": Retries Calendar event creation for CONFIRMATION_PENDING bookings.
 * 4. POST action="update_status": Updates booking or payment status manually.
 */

const { getAllBookings, getAllPayments, updateBookingCalendarDetails, updateBookingPaymentStatus, updateBookingTelegramStatus } = require('../../lib/sheets');
const { createAppointmentEvent } = require('../../lib/calendar');
const https = require('https');

function verifyAdminAuth(req) {
  const secretKey = process.env.ADMIN_SECRET_KEY;
  if (!secretKey) {
    return { valid: false, error: 'ADMIN_SECRET_KEY_NOT_SET' };
  }
  const providedSecret = req.headers['x-admin-secret'] || (req.query && req.query.secret);
  if (providedSecret === secretKey) {
    return { valid: true };
  }
  return { valid: false, error: 'UNAUTHORIZED' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Parse Query
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  req.query = Object.fromEntries(parsedUrl.searchParams.entries());

  const authCheck = verifyAdminAuth(req);
  if (!authCheck.valid) {
    if (authCheck.error === 'ADMIN_SECRET_KEY_NOT_SET') {
      return res.status(500).json({ error: 'Server misconfiguration: ADMIN_SECRET_KEY environment variable is not configured.' });
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing admin secret.' });
  }

  try {
    if (req.method === 'GET') {
      const [bookingsRes, paymentsRes] = await Promise.all([
        getAllBookings(),
        getAllPayments()
      ]);

      return res.status(200).json({
        success: true,
        bookings: bookingsRes.bookings || [],
        payments: paymentsRes.payments || [],
        errors: {
          bookingsError: bookingsRes.error || null,
          paymentsError: paymentsRes.error || null
        }
      });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const { action, bookingId, appointmentStatus, paymentStatus } = body;

      if (!bookingId) {
        return res.status(400).json({ error: 'Booking ID is required.' });
      }

      if (action === 'retry_calendar_sync') {
        const { bookings } = await getAllBookings();
        const booking = bookings.find(b => b.booking_id === bookingId);

        if (!booking) {
          return res.status(404).json({ error: `Booking ${bookingId} not found.` });
        }

        const cleanDate = booking.appointment_date || new Date().toISOString().split('T')[0];
        const cleanTime = booking.appointment_time || '10:00 AM';

        let startIso = `${cleanDate}T10:00:00+05:30`;
        let endIso = `${cleanDate}T10:30:00+05:30`;
        if (cleanTime && cleanTime.includes(':')) {
          const match = cleanTime.match(/(\d+):(\d+)\s*(AM|PM)?/i);
          if (match) {
            let h = parseInt(match[1], 10);
            const m = parseInt(match[2], 10);
            const ampm = match[3] ? match[3].toUpperCase() : '';
            if (ampm === 'PM' && h < 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
            const hStr = String(h).padStart(2, '0');
            const mStr = String(m).padStart(2, '0');
            startIso = `${cleanDate}T${hStr}:${mStr}:00+05:30`;
            const endH = h + Math.floor((m + 30) / 60);
            const endM = (m + 30) % 60;
            endIso = `${cleanDate}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00+05:30`;
          }
        }

        const calRes = await createAppointmentEvent({
          summary: `REVA Health Consultation: ${booking.patient_name || 'Patient'}`,
          description: `Confirmed Medical Consultation (Admin Retry Sync)\nBooking ID: ${bookingId}\nPatient: ${booking.patient_name}\nPhone: ${booking.phone_number}\nEmail: ${booking.email}`,
          startIso: startIso,
          endIso: endIso,
          patientName: booking.patient_name,
          patientEmail: booking.email,
          patientPhone: booking.phone_number,
          bookingId: bookingId
        });

        if (!calRes.success) {
          return res.status(500).json({
            success: false,
            error: calRes.error || 'Failed to sync with Google Calendar API.'
          });
        }

        await updateBookingCalendarDetails(bookingId, calRes.eventId, 'CONFIRMED');

        // Optional Telegram Alert
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
        const isPlaceholder = !token || !chatId || token.includes('your_') || token.includes('temporary_') || chatId.includes('your_');

        if (!isPlaceholder) {
          const messageText = `REVA HEALTH CALENDAR SYNC RECOVERED (${bookingId})\n\n` +
            `Patient: ${booking.patient_name}\n` +
            `Date & Time: ${cleanDate} at ${cleanTime}\n` +
            `Google Meet Link: ${calRes.meetingLink || 'Scheduled'}\n` +
            `Status: CONFIRMED (Admin Action)`;

          const telegramData = JSON.stringify({
            chat_id: chatId,
            text: messageText,
            parse_mode: 'HTML'
          });

          const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${token}/sendMessage`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(telegramData)
            }
          };

          const tgReq = https.request(options, (tgRes) => {
            if (tgRes.statusCode === 200) {
              updateBookingTelegramStatus(bookingId, 'SENT');
            }
          });
          tgReq.on('error', (e) => console.error('Telegram admin retry notification error:', e.message));
          tgReq.write(telegramData);
          tgReq.end();
        }

        return res.status(200).json({
          success: true,
          bookingId: bookingId,
          calendarEventId: calRes.eventId,
          meetingLink: calRes.meetingLink,
          message: 'Calendar event successfully created and booking status set to CONFIRMED.'
        });
      }

      if (action === 'update_status') {
        const targetApptStatus = appointmentStatus || 'CONFIRMED';
        const targetPayStatus = paymentStatus || 'PAID';

        const updateRes = await updateBookingPaymentStatus(
          bookingId,
          targetPayStatus,
          '',
          '',
          targetApptStatus
        );

        if (!updateRes.success) {
          return res.status(500).json({ error: updateRes.error || 'Failed to update status in Google Sheets.' });
        }

        return res.status(200).json({
          success: true,
          bookingId: bookingId,
          appointmentStatus: targetApptStatus,
          paymentStatus: targetPayStatus,
          message: 'Status updated successfully.'
        });
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });

  } catch (err) {
    console.error('Error in /api/admin/bookings handler:', err.message || err);
    return res.status(500).json({ error: 'Internal Server Error in Admin API' });
  }
};
