const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('confirmBooking -> email double escape prevention', async (t) => {
  // Clear require cache for complete isolation
  Object.keys(require.cache).forEach(key => delete require.cache[key]);

  // Track what gets sent to email
  let capturedEmailPayload = null;

  // Mock Email
  const emailPath = require.resolve('../lib/email.js');
  require.cache[emailPath] = {
    id: emailPath,
    filename: emailPath,
    loaded: true,
    exports: {
      sendBookingConfirmationEmail: (payload) => {
        capturedEmailPayload = payload;
      }
    }
  };

  // Mock Sheets
  const sheetsPath = require.resolve('../lib/sheets.js');
  require.cache[sheetsPath] = {
    id: sheetsPath,
    filename: sheetsPath,
    loaded: true,
    exports: {
      getSheetsClient: () => ({ client: null, sheetId: null }),
      getAllBookings: async () => ({
        bookings: [
          {
            booking_id: 'TEST_ID',
            patient_name: "O'Brien & Co",
            email: 'test@example.com',
            phone_number: '9876543210',
            service_name: 'Consultation',
            appointment_date: '2026-10-10',
            appointment_time: '10:00 AM'
          }
        ]
      }),
      updateBookingPaymentStatus: async () => ({ success: true }),
      updateBookingCalendarDetails: async () => ({ success: true }),
      updateBookingTelegramStatus: async () => ({ success: true })
    }
  };

  // Mock Calendar
  const calPath = require.resolve('../lib/calendar.js');
  require.cache[calPath] = {
    id: calPath,
    filename: calPath,
    loaded: true,
    exports: {
      createAppointmentEvent: async () => ({ success: true, eventId: '123', meetingLink: 'https://meet.google.com/test' })
    }
  };
  
  // Mock WhatsApp Link
  const waLinkPath = require.resolve('../lib/whatsapp-link.js');
  require.cache[waLinkPath] = {
    id: waLinkPath,
    filename: waLinkPath,
    loaded: true,
    exports: {
      buildWhatsAppLink: () => 'https://wa.me/test'
    }
  };

  // Prevent HTTPS requests (Telegram mock)
  const https = require('https');
  const originalRequest = https.request;
  https.request = (...args) => {
    // Return dummy request object that immediately resolves
    const cb = args.find(a => typeof a === 'function');
    if (cb) cb({ on: (event, handler) => { if (event === 'end') handler(); } });
    return { on: () => {}, write: () => {}, end: () => {} };
  };

  // Require confirmBooking module
  const { confirmBooking } = require('../lib/confirm-booking');

  // Trigger confirmation
  await confirmBooking({
    bookingId: 'TEST_ID',
    razorpayPaymentId: 'pay_test',
    razorpayOrderId: 'order_test',
    source: 'test'
  });

  // Restore HTTPS
  https.request = originalRequest;

  // Assertions
  assert.ok(capturedEmailPayload !== null, 'sendBookingConfirmationEmail was not called');
  assert.strictEqual(
    capturedEmailPayload.patientName,
    "O'Brien & Co",
    'patientName should be RAW, not HTML-escaped'
  );
  assert.strictEqual(
    capturedEmailPayload.packageName,
    'Consultation',
    'packageName should also be RAW'
  );
});
