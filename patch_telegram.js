const fs = require('fs');
let code = fs.readFileSync('lib/confirm-booking.js', 'utf8');

// Modify sendTelegramMessage function signature and implementation
code = code.replace(
  'async function sendTelegramMessage(text) {\n    const token  = process.env.TELEGRAM_BOT_TOKEN;',
  'async function sendTelegramMessage(text, replyMarkup) {\n    const token  = process.env.TELEGRAM_BOT_TOKEN;'
);
code = code.replace(
  "const data = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });",
  "const payload = { chat_id: chatId, text, parse_mode: 'HTML' };\n    if (replyMarkup) payload.reply_markup = replyMarkup;\n    const data = JSON.stringify(payload);"
);

// Inject the meet URL and update the await sendTelegramMessage call
const targetMsg = '    await sendTelegramMessage(\n      `✅ <b>REVA HEALTH PAYMENT RECEIVED</b> (${escHtml(bookingId)})\\n` +\n      waHtml + `\\n` +\n      `Patient: ${authName}\\nPhone: ${authPhone}\\n` +\n      `Package: ${escHtml(bookingRow.service_name || \'Doctor Consultation\')}\\n` +\n      `Amount Paid: \\u20B9${authAmt}\\n` +\n      `Payment ID: <code>${escHtml(razorpayPaymentId)}</code>\\n` +\n      `Date &amp; Time: ${escHtml(cleanDate)} at ${escHtml(cleanTime)}\\n` +\n      `Google Meet Link: ${calRes.meetingLink || \'Scheduled / Sync Pending\'}\\n` +\n      `Source: ${escHtml(source)}\\n\\n` +\n      `Status: ${calStatusTag}`\n    ).catch(() => {});';

const replacementMsg = `    const meetUrl = \`https://www.revahealth.in/admin/meet.html?id=\${encodeURIComponent(bookingId)}&name=\${encodeURIComponent(rawName)}&phone=\${encodeURIComponent(bookingRow.phone_number || '')}&package=\${encodeURIComponent(rawPackage)}\`;
    const replyMarkup = {
      inline_keyboard: [
        [{ text: "🎥 Add Meeting Link", url: meetUrl }]
      ]
    };

    await sendTelegramMessage(
      \`✅ <b>REVA HEALTH PAYMENT RECEIVED</b> (\${escHtml(bookingId)})\\n\` +
      waHtml + \`\\n\` +
      \`Patient: \${authName}\\nPhone: \${authPhone}\\n\` +
      \`Package: \${escHtml(bookingRow.service_name || 'Doctor Consultation')}\\n\` +
      \`Amount Paid: \\u20B9\${authAmt}\\n\` +
      \`Payment ID: <code>\${escHtml(razorpayPaymentId)}</code>\\n\` +
      \`Date &amp; Time: \${escHtml(cleanDate)} at \${escHtml(cleanTime)}\\n\` +
      \`Google Meet Link: \${calRes.meetingLink || 'Scheduled / Sync Pending'}\\n\` +
      \`Source: \${escHtml(source)}\\n\\n\` +
      \`Status: \${calStatusTag}\`,
      replyMarkup
    ).catch(() => {});`;

code = code.replace(targetMsg, replacementMsg);
fs.writeFileSync('lib/confirm-booking.js', code);
console.log('Modified confirm-booking.js', code.includes('replyMarkup'));
