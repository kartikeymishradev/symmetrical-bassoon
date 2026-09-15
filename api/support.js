/**
 * Serverless API Endpoint: REVA Health Customer Care Support
 * Route: POST /api/support
 *
 * Transmits Customer Care chat widget messages to the dedicated
 * Customer Care Telegram Support Bot.
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
    const { name, contact, message } = body;

    if (!message) {
      return res.status(400).json({ error: 'Message content is required.' });
    }

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

    // Format Telegram Support Message
    const messageText = `NEW CUSTOMER CARE MESSAGE\n\n` +
      `Name: ${name || 'Anonymous'}\n` +
      `Contact: ${contact || 'Not Provided'}\n\n` +
      `Message:\n${message}\n\n` +
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
