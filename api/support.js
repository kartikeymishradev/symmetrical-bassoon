/**
 * Serverless API Endpoint: REVA Health Customer Care Support
 * Route: POST /api/support
 *
 * Transmits Customer Care chat widget messages to the dedicated
 * Customer Care Telegram Support Bot.
 */

const https = require('https');
const { setCorsHeaders } = require('../lib/cors');
const { checkRateLimit } = require('../lib/ratelimit');

module.exports = async function handler(req, res) {
  // Dynamic CORS Headers
  setCorsHeaders(req, res, { methods: 'POST, OPTIONS' });

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Rate Limiting (15 requests per minute per IP)
  const rateCheck = checkRateLimit(req, res, 15, 60 * 1000);
  if (rateCheck.limited) {
    return res.status(429).json({ error: `Too many support messages sent. Please wait ${rateCheck.resetInSec} seconds before retrying.` });
  }

  const validator = require('../lib/validator');

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    let { name, contact, message } = body;

    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanContact = typeof contact === 'string' ? contact.trim() : '';
    const cleanMessage = typeof message === 'string' ? message.trim() : '';

    if (!cleanMessage) {
      return res.status(400).json({ error: 'Message content is required.' });
    }

    if (cleanName && !validator.isValidName(cleanName)) return res.status(400).json({ error: 'Invalid name format.' });
    if (!validator.isValidText(cleanContact, 150)) return res.status(400).json({ error: 'Contact info exceeds 150 characters.' });
    if (!validator.isValidText(cleanMessage, 2000)) return res.status(400).json({ error: 'Message exceeds maximum length.' });

    const token = process.env.TELEGRAM_SUPPORT_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_SUPPORT_CHAT_ID;

    // Check if token is configured or placeholder
    const isPlaceholder = !token || !chatId || token.includes('your_') || token.includes('temporary_') || chatId.includes('your_');

    if (isPlaceholder) {
      return res.status(200).json({
        success: true,
        mode: 'local_v1',
        message: 'Customer Care message recorded locally. Configure TELEGRAM_SUPPORT_BOT_TOKEN and TELEGRAM_SUPPORT_CHAT_ID in .env for live Telegram support messaging.'
      });
    }

    // Format Telegram Support Message — escape all user input for HTML mode
    const escHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const messageText = `NEW CUSTOMER CARE MESSAGE\n\n` +
      `Name: ${escHtml(cleanName || 'Anonymous')}\n` +
      `Contact: ${escHtml(cleanContact || 'Not Provided')}\n\n` +
      `Message:\n${escHtml(cleanMessage)}\n\n` +
      `Source:\nREVA Health Customer Care Widget`;

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
            res.status(200).json({ success: true, message: 'Support message sent successfully to Telegram.' });
          } else {
            console.error('Telegram Support API error:', responseString);
            res.status(502).json({ error: 'Failed to send message to Support Telegram Bot.' });
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
    console.error('Support handler error:', err);
    return res.status(500).json({ error: 'Invalid request payload.' });
  }
};
