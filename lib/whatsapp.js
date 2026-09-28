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

  console.log(`[WHATSAPP_HOOK] Notification prepared for Booking ID ${bookingId}`);

  if (!token || !phoneNumberId) {
    return { success: false, reason: 'whatsapp_unconfigured_logged' };
  }

  const cleanPatientName = (patientName || 'Patient').substring(0, 60).replace(/\r?\n/g, ' ');

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
              { type: 'text', text: cleanPatientName },
              { type: 'text', text: packageName || 'Doctor Consultation' },
              { type: 'text', text: `${date} ${time || ''}`.trim() },
              { type: 'text', text: meetingLink || 'Scheduled' }
            ]
          }
        ]
      }
    });

    const apiVersion = (process.env.WHATSAPP_API_VERSION || 'v18.0').replace(/[^a-zA-Z0-9.]/g, '');

    const options = {
      hostname: 'graph.facebook.com',
      port: 443,
      path: `/${apiVersion}/${phoneNumberId}/messages`,
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
            let parsed;
            try {
              parsed = JSON.parse(body);
            } catch (e) {
              parsed = body; // fallback to raw body if not valid JSON
            }
            resolve({ success: true, response: parsed });
          } else {
            console.error('WhatsApp API error response for Booking ID', bookingId);
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
