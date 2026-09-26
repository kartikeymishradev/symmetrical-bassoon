/**
 * REVA Health — WhatsApp Communication Service Layer (AiSensy / WhatsApp Business API Hook)
 *
 * Extensible interface for automated WhatsApp confirmation messages.
 * Logs payload in current phase and structure for instant activation when credentials are added.
 */

const https = require('https');

function getWhatsAppCredentials() {
  const token = (process.env.WHATSAPP_API_TOKEN || process.env.AISENSY_API_KEY || '').trim();
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  return { token, phoneNumberId };
}

/**
 * Dispatches WhatsApp confirmation message to patient.
 */
async function sendWhatsAppConfirmation({ phone, patientName, date, time, meetingLink, bookingId, packageName }) {
  const { token, phoneNumberId } = getWhatsAppCredentials();
  const formattedPhone = (phone || '').replace(/[^0-9]/g, '');
  const maskedPhone = formattedPhone.length >= 4
    ? '*'.repeat(Math.max(0, formattedPhone.length - 4)) + formattedPhone.slice(-4)
    : '****';

  console.log(`[WHATSAPP_HOOK] Notification prepared for ${patientName} (${maskedPhone}): Booking ID ${bookingId}, Date: ${date} ${time}, Meet Link: ${meetingLink || 'N/A'}`);

  if (!token || !phoneNumberId) {
    return { success: false, reason: 'whatsapp_unconfigured_logged' };
  }

  try {
    const payload = JSON.stringify({
      messaging_product: 'whatsapp',
      to: formattedPhone,
      type: 'template',
      template: {
        name: 'consultation_booking_confirmation',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: patientName || 'Patient' },
              { type: 'text', text: packageName || 'Doctor Consultation' },
              { type: 'text', text: `${date} ${time || ''}`.trim() },
              { type: 'text', text: meetingLink || 'Scheduled' }
            ]
          }
        ]
      }
    });

    const options = {
      hostname: 'graph.facebook.com',
      port: 443,
      path: `/v18.0/${phoneNumberId}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve({ success: true, response: JSON.parse(body) });
          } else {
            console.error('WhatsApp API error response:', body);
            resolve({ success: false, error: body });
          }
        });
      });

      req.on('error', (err) => {
        console.error('WhatsApp API request error:', err.message);
        resolve({ success: false, error: err.message });
      });

      req.write(payload);
      req.end();
    });

  } catch (err) {
    console.error('Error dispatching WhatsApp message:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  getWhatsAppCredentials,
  sendWhatsAppConfirmation
};
