/**
 * Serverless API Endpoint: REVA Health Consultation Enquiry
 * Route: POST /api/enquiry
 *
 * 1. Validates input fields (name and phone required).
 * 2. Appends actual enquiry entry to Google Sheets ('Bookings' tab, 17 columns A:Q).
 * 3. Transmits enquiry notification to Telegram Admin Chat (if configured).
 * 4. Updates telegram_status accurately ('SENT', 'FAILED', or 'LOCAL').
 */

const https = require('https');
const { appendBooking, updateBookingTelegramStatus, getServiceAmount } = require('../lib/sheets');

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

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { name, phone, email, package: pkg, condition, date, notes } = body;

    // Strict Input Validation
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    const cleanPackage = typeof pkg === 'string' ? pkg.trim() : '';
    const cleanCondition = typeof condition === 'string' ? condition.trim() : '';
    const cleanDate = typeof date === 'string' ? date.trim() : '';
    const cleanNotes = typeof notes === 'string' ? notes.trim() : '';

    if (!cleanName || !cleanPhone) {
      return res.status(400).json({ error: 'Name and phone number are required.' });
    }

    const timestamp = new Date().toISOString();
    const bookingId = `ENQ-${Date.now().toString(36).toUpperCase()}`;

    // Prefer amount from Services sheet, with fallback to package string extraction
    const amount = await getServiceAmount(cleanPackage, cleanPackage);

    // Format Notes field
    const notesSummary = cleanCondition
      ? `[Focus: ${cleanCondition}] ${cleanNotes}`.trim()
      : (cleanNotes || 'Submitted from REVA Health Website');

    // Check Telegram token configuration to determine initial telegram_status
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    const isPlaceholder = !token || !chatId || token.includes('your_') || token.includes('temporary_') || chatId.includes('your_');
    const telegramStatusInitial = isPlaceholder ? 'LOCAL' : 'PENDING';

    // Construct 17-Column Sheets Row matching 'Bookings' headers A:Q exactly
    // Col A: booking_id
    // Col B: created_at
    // Col C: patient_name
    // Col D: phone
    // Col E: email
    // Col F: service
    // Col G: amount
    // Col H: payment_status
    // Col I: razorpay_payment_id
    // Col J: razorpay_link_id
    // Col K: appointment_date
    // Col L: appointment_time
    // Col M: appointment_status
    // Col N: assigned_to
    // Col O: telegram_status
    // Col P: notes
    // Col Q: updated_at
    const sheetsRow = [
      bookingId,
      timestamp,
      cleanName,
      cleanPhone,
      cleanEmail,
      cleanPackage || 'General Consultation',
      amount,
      'PENDING',
      '',
      '',
      cleanDate || timestamp.split('T')[0],
      '',
      'REQUESTED',
      '',
      telegramStatusInitial,
      notesSummary,
      timestamp
    ];

    // 1. Write to Google Sheets
    let sheetsSuccess = false;
    let updatedRange = null;
    try {
      const sheetsRes = await appendBooking(sheetsRow);
      sheetsSuccess = sheetsRes.success;
      if (sheetsRes.updatedRange) updatedRange = sheetsRes.updatedRange;
    } catch (sheetsErr) {
      console.error('Google Sheets append error:', sheetsErr.message || sheetsErr);
    }

    // 2. Transmit to Telegram (if configured)
    if (isPlaceholder) {
      return res.status(200).json({
        success: true,
        mode: 'local_v1',
        bookingId: bookingId,
        sheetsRecorded: sheetsSuccess,
        appendedRange: updatedRange,
        message: sheetsSuccess
          ? 'Enquiry recorded in Google Sheets! Configure TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID in .env for live Telegram notifications.'
          : 'Enquiry recorded locally on V1. Configure TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID in .env for live Telegram notifications.'
      });
    }

    // Format Telegram Message
    const messageText = `NEW REVA HEALTH ENQUIRY (${bookingId})\n\n` +
      `Name: ${cleanName}\n` +
      `Phone: ${cleanPhone}\n` +
      `Email: ${cleanEmail || 'N/A'}\n` +
      `Plan Interest: ${cleanPackage || 'General Consultation'}\n` +
      `Primary Focus: ${cleanCondition || 'N/A'}\n` +
      `Preferred Date: ${cleanDate || 'N/A'}\n\n` +
      `Notes:\n${cleanNotes || 'None'}\n\n` +
      `Submitted from:\nREVA Health Website`;

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

    return new Promise((resolve) => {
      const tgReq = https.request(options, (tgRes) => {
        let responseString = '';
        tgRes.on('data', chunk => responseString += chunk);
        tgRes.on('end', async () => {
          if (tgRes.statusCode === 200) {
            if (sheetsSuccess) await updateBookingTelegramStatus(bookingId, 'SENT');
            res.status(200).json({
              success: true,
              bookingId: bookingId,
              sheetsRecorded: sheetsSuccess,
              appendedRange: updatedRange,
              message: 'Enquiry processed successfully and sent to Telegram.'
            });
          } else {
            console.error('Telegram API error:', responseString);
            if (sheetsSuccess) {
              await updateBookingTelegramStatus(bookingId, 'FAILED');
              res.status(200).json({
                success: true,
                bookingId: bookingId,
                sheetsRecorded: true,
                appendedRange: updatedRange,
                message: 'Enquiry recorded in Google Sheets (Telegram notification failed).'
              });
            } else {
              res.status(502).json({ error: 'Failed to send message to Telegram Bot.' });
            }
          }
          resolve();
        });
      });

      tgReq.on('error', async (err) => {
        console.error('HTTPS request error:', err);
        if (sheetsSuccess) {
          await updateBookingTelegramStatus(bookingId, 'FAILED');
          res.status(200).json({
            success: true,
            bookingId: bookingId,
            sheetsRecorded: true,
            appendedRange: updatedRange,
            message: 'Enquiry recorded in Google Sheets.'
          });
        } else {
          res.status(500).json({ error: 'Internal server error while reaching Telegram API.' });
        }
        resolve();
      });

      tgReq.write(telegramData);
      tgReq.end();
    });

  } catch (err) {
    console.error('Enquiry handler error:', err);
    return res.status(500).json({ error: 'Invalid request payload.' });
  }
};
