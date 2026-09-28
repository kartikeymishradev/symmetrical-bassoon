const { test, describe, mock, beforeEach } = require('node:test');
const assert = require('node:assert');

// Mock out the modules before requiring the handler
const mockSheets = {
  getAllBookings: mock.fn(async () => ({ bookings: [] })),
  appendPayment: mock.fn(async () => ({ success: true })),
  updateBookingPaymentStatus: mock.fn(async () => ({ success: true })),
  isPaymentRecorded: mock.fn(async () => false)
};
const mockRazorpay = {
  verifyPaymentSignature: mock.fn(() => ({ isValid: true, mode: 'live_razorpay' }))
};
const mockConfirmBooking = {
  confirmBooking: mock.fn(async () => ({
    outcome: 'confirmed',
    appointmentStatus: 'CONFIRMED',
    meetingLink: 'http://meet',
    calendarEventCreated: true,
    bookingUpdated: true
  })),
  escHtml: (s) => s
};
const mockWhatsapp = {
  sendWhatsAppConfirmation: mock.fn()
};
const mockHttps = {
  request: mock.fn(() => {
    return {
      on: () => {},
      write: () => {},
      end: () => {}
    };
  })
};

// We intercept requires by polluting require.cache (typical for CommonJS simple mocks)
const sheetsPath = require.resolve('../lib/sheets');
const razorpayPath = require.resolve('../lib/razorpay');
const confirmPath = require.resolve('../lib/confirm-booking');
const whatsappPath = require.resolve('../lib/whatsapp');
const httpsPath = 'https';

require.cache[sheetsPath] = { id: sheetsPath, filename: sheetsPath, loaded: true, exports: mockSheets };
require.cache[razorpayPath] = { id: razorpayPath, filename: razorpayPath, loaded: true, exports: mockRazorpay };
require.cache[confirmPath] = { id: confirmPath, filename: confirmPath, loaded: true, exports: mockConfirmBooking };
require.cache[whatsappPath] = { id: whatsappPath, filename: whatsappPath, loaded: true, exports: mockWhatsapp };
require.cache[httpsPath] = { id: httpsPath, filename: httpsPath, loaded: true, exports: mockHttps };

const verifyPaymentHandler = require('../api/verify-payment');

describe('verify-payment Security Hardening (P0-1)', () => {
  beforeEach(() => {
    mockSheets.getAllBookings.mock.resetCalls();
    mockSheets.appendPayment.mock.resetCalls();
    mockSheets.isPaymentRecorded.mock.resetCalls();
    mockRazorpay.verifyPaymentSignature.mock.resetCalls();
    mockConfirmBooking.confirmBooking.mock.resetCalls();
    mockWhatsapp.sendWhatsAppConfirmation.mock.resetCalls();
    mockHttps.request.mock.resetCalls();
  });

  const mockRes = () => {
    const res = {};
    res.status = mock.fn(() => res);
    res.json = mock.fn(() => res);
    res.end = mock.fn(() => res);
    res.setHeader = mock.fn(() => res);
    return res;
  };

  test('(a) forged signature -> no Telegram call and no Sheets write', async () => {
    mockRazorpay.verifyPaymentSignature.mock.mockImplementationOnce(() => ({ isValid: false }));
    const req = {
      method: 'POST',
      headers: {},
      body: { bookingId: 'b1', razorpay_payment_id: 'pay_1', razorpay_order_id: 'ord_1', razorpay_signature: 'bad' }
    };
    const res = mockRes();

    await verifyPaymentHandler(req, res);

    assert.strictEqual(res.status.mock.calls[0].arguments[0], 400);
    assert.strictEqual(mockSheets.appendPayment.mock.calls.length, 0);
    assert.strictEqual(mockSheets.getAllBookings.mock.calls.length, 0); // Fails before reading sheets
    assert.strictEqual(mockHttps.request.mock.calls.length, 0);
  });

  test('(b) missing booking row -> rejected', async () => {
    mockRazorpay.verifyPaymentSignature.mock.mockImplementationOnce(() => ({ isValid: true }));
    mockSheets.getAllBookings.mock.mockImplementationOnce(async () => ({ bookings: [] }));

    const req = {
      method: 'POST',
      headers: {},
      body: { bookingId: 'b1', razorpay_payment_id: 'pay_1', razorpay_order_id: 'ord_1', razorpay_signature: 'sig' }
    };
    const res = mockRes();

    await verifyPaymentHandler(req, res);

    assert.strictEqual(res.status.mock.calls[0].arguments[0], 404);
    assert.match(res.json.mock.calls[0].arguments[0].error, /Booking not found/);
    assert.strictEqual(mockConfirmBooking.confirmBooking.mock.calls.length, 0);
  });

  test('(c) mismatched order id -> rejected', async () => {
    mockRazorpay.verifyPaymentSignature.mock.mockImplementationOnce(() => ({ isValid: true }));
    mockSheets.getAllBookings.mock.mockImplementationOnce(async () => ({
      bookings: [{ booking_id: 'b1', razorpay_link_id: 'ord_REAL' }]
    }));

    const req = {
      method: 'POST',
      headers: {},
      body: { bookingId: 'b1', razorpay_payment_id: 'pay_1', razorpay_order_id: 'ord_FAKE', razorpay_signature: 'sig' }
    };
    const res = mockRes();

    await verifyPaymentHandler(req, res);

    assert.strictEqual(res.status.mock.calls[0].arguments[0], 400);
    assert.match(res.json.mock.calls[0].arguments[0].error, /Payment order does not match/);
    assert.strictEqual(mockConfirmBooking.confirmBooking.mock.calls.length, 0);
  });

  test('(d) body-supplied date/time/phone are ignored', async () => {
    mockRazorpay.verifyPaymentSignature.mock.mockImplementationOnce(() => ({ isValid: true }));
    mockSheets.getAllBookings.mock.mockImplementationOnce(async () => ({
      bookings: [{ 
        booking_id: 'b1', 
        razorpay_link_id: 'ord_1',
        patient_name: 'Sheet Name',
        phone_number: 'Sheet Phone',
        appointment_date: 'Sheet Date',
        appointment_time: 'Sheet Time'
      }]
    }));

    const req = {
      method: 'POST',
      headers: {},
      body: { 
        bookingId: 'b1', razorpay_payment_id: 'pay_1', razorpay_order_id: 'ord_1', razorpay_signature: 'sig',
        date: 'Body Date', time: 'Body Time', phone: 'Body Phone', name: 'Body Name'
      }
    };
    const res = mockRes();

    await verifyPaymentHandler(req, res);

    assert.strictEqual(res.status.mock.calls[0].arguments[0], 200);
    
    // confirmBooking should NOT receive the body hints anymore
    const confirmArgs = mockConfirmBooking.confirmBooking.mock.calls[0].arguments[0];
    assert.strictEqual(confirmArgs.date, undefined);
    assert.strictEqual(confirmArgs.time, undefined);
    assert.strictEqual(confirmArgs.phone, undefined);
    assert.strictEqual(confirmArgs.name, undefined);
    assert.strictEqual(confirmArgs.bookingId, 'b1');

    // WhatsApp should use sheet data, not body data
    const waArgs = mockWhatsapp.sendWhatsAppConfirmation.mock.calls[0].arguments[0];
    assert.strictEqual(waArgs.patientName, 'Sheet Name');
    assert.strictEqual(waArgs.phone, 'Sheet Phone');
  });
});
