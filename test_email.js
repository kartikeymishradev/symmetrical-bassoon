const { sendBookingConfirmationEmail } = require('./lib/email');

async function testEmail() {
  const result = await sendBookingConfirmationEmail({
    to: 'kartikeymishra.dev@gmail.com',
    patientName: 'Test Patient (Kartikey)',
    bookingId: 'TEST-123456',
    packageName: 'Comprehensive Wellness Plan',
    date: '2026-10-15',
    time: '10:00 AM',
    meetingLink: 'https://meet.google.com/test-abc-xyz'
  });
  console.log('Result:', result);
}

testEmail();
