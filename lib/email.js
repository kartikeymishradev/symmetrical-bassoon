const nodemailer = require('nodemailer');

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendBookingConfirmationEmail({ to, patientName, bookingId, packageName, date, time, meetingLink }) {
  try {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

    if (!SMTP_HOST || SMTP_HOST === 'smtp.example.com' || !SMTP_USER) {
      console.log(`[EMAIL] SMTP not configured. Skipping email for booking ${bookingId}`);
      return { success: false, reason: 'email_unconfigured' };
    }

    if (!to) {
      console.log(`[EMAIL] No email provided for booking ${bookingId}. Skipping.`);
      return { success: false, reason: 'no_email_provided' };
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT, 10) || 587,
      secure: parseInt(SMTP_PORT, 10) === 465, 
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });

    const safeName = escHtml(patientName);
    const safePackage = escHtml(packageName);
    const safeDate = escHtml(date);
    const safeTime = escHtml(time);
    // Prevent javascript: XSS
    let safeMeetingLink = meetingLink || '';
    if (safeMeetingLink && !safeMeetingLink.startsWith('http://') && !safeMeetingLink.startsWith('https://')) {
      safeMeetingLink = 'https://' + safeMeetingLink;
    }
    safeMeetingLink = encodeURI(safeMeetingLink);

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #17212B; max-width: 600px; margin: 0 auto; border: 1px solid #E8EBE8; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #0B6B62; padding: 20px; text-align: center;">
          <h1 style="color: #FFFFFF; margin: 0; font-size: 24px;">Booking Confirmed</h1>
        </div>
        <div style="padding: 30px; background-color: #FAFAFA;">
          <p style="font-size: 16px;">Dear <strong>${safeName}</strong>,</p>
          <p style="font-size: 16px;">Your payment has been successfully verified and your consultation is confirmed. Here are your booking details:</p>
          
          <table style="width: 100%; border-collapse: collapse; margin-top: 20px; background-color: #FFFFFF; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <tr>
              <td style="padding: 12px 15px; border-bottom: 1px solid #E8EBE8; color: #667085; width: 40%;">Booking ID</td>
              <td style="padding: 12px 15px; border-bottom: 1px solid #E8EBE8; font-weight: bold;">${escHtml(bookingId)}</td>
            </tr>
            <tr>
              <td style="padding: 12px 15px; border-bottom: 1px solid #E8EBE8; color: #667085;">Package</td>
              <td style="padding: 12px 15px; border-bottom: 1px solid #E8EBE8; font-weight: bold;">${safePackage}</td>
            </tr>
            <tr>
              <td style="padding: 12px 15px; border-bottom: 1px solid #E8EBE8; color: #667085;">Date</td>
              <td style="padding: 12px 15px; border-bottom: 1px solid #E8EBE8; font-weight: bold;">${safeDate}</td>
            </tr>
            <tr>
              <td style="padding: 12px 15px; border-bottom: 1px solid #E8EBE8; color: #667085;">Time</td>
              <td style="padding: 12px 15px; border-bottom: 1px solid #E8EBE8; font-weight: bold;">${safeTime}</td>
            </tr>
          </table>

          <div style="margin-top: 30px; text-align: center;">
            <a href="${safeMeetingLink}" style="background-color: #0B6B62; color: #FFFFFF; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Join Google Meet</a>
          </div>

          <p style="margin-top: 30px; font-size: 14px; color: #667085; text-align: center;">
            If you have any questions, feel free to reply to this email or contact us via WhatsApp.
          </p>
        </div>
        <div style="background-color: #F0F2EF; padding: 15px; text-align: center; font-size: 12px; color: #667085;">
          &copy; ${new Date().getFullYear()} REVA Health. All rights reserved.
        </div>
      </div>
    `;

    const info = await transporter.sendMail({
      from: '"REVA Health" <' + SMTP_USER + '>',
      to,
      subject: "Booking Confirmed - " + safePackage + " (" + escHtml(bookingId) + ")",
      html: htmlBody,
    });

    console.log(`[EMAIL] Confirmation sent for booking ${bookingId}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };

  } catch (error) {
    console.error(`[EMAIL] Failed to send email for booking ${bookingId}:`, error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendBookingConfirmationEmail,
  escHtml
};
