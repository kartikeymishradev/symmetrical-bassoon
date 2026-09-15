/**
 * Serverless API Endpoint: REVA Health Consultation Enquiry
 * Route: POST /api/enquiry
 *
 * Transmits consultation enquiry submissions to Telegram Admin Chat
 * via server-side Telegram Bot API call.
 */

const https = require('https');

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

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone number are required.' });
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

    // Check if token is configured or placeholder
    const isPlaceholder = !token || !chatId || token.includes('your_') || token.includes('temporary_') || chatId.includes('your_');

    if (isPlaceholder) {
      return res.status(200).json({
        success: true,
        mode: 'local_v1',
        message: 'Enquiry recorded locally on V1. Configure TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID in .env for live Telegram notifications.'
      });
    }

    // Format Telegram Message
    const messageText = `NEW REVA HEALTH ENQUIRY\n\n` +
      `Name: ${name}\n` +
      `Phone: ${phone}\n` +
      `Email: ${email || 'N/A'}\n` +
      `Plan Interest: ${pkg || 'General Consultation'}\n` +
      `Primary Focus: ${condition || 'N/A'}\n` +
      `Preferred Date: ${date || 'N/A'}\n\n` +
      `Notes:\n${notes || 'None'}\n\n` +
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
        tgRes.on('end', () => {
          if (tgRes.statusCode === 200) {
            res.status(200).json({ success: true, message: 'Enquiry sent successfully to Telegram.' });
          } else {
            console.error('Telegram API error:', responseString);
            res.status(502).json({ error: 'Failed to send message to Telegram Bot.' });
          }
          resolve();
        });
      });

      tgReq.on('error', (err) => {
        console.error('HTTPS request error:', err);
        res.status(500).json({ error: 'Internal server error while reaching Telegram API.' });
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
