const { test, describe, mock, beforeEach } = require('node:test');
const assert = require('node:assert');

// Mock googleapis
const mockSheetsValuesGet = mock.fn();
const mockSheetsValuesBatchUpdate = mock.fn(async () => ({}));
const googleMock = {
  google: {
    auth: {
      GoogleAuth: class {
        getClient() { return {}; }
      }
    },
    sheets: () => ({
      spreadsheets: {
        values: {
          get: mockSheetsValuesGet,
          batchUpdate: mockSheetsValuesBatchUpdate
        }
      }
    })
  }
};
require.cache[require.resolve('googleapis')] = { id: require.resolve('googleapis'), filename: require.resolve('googleapis'), loaded: true, exports: googleMock };

// We must set env vars for getSheetsClient to return a client
process.env.GOOGLE_SHEET_ID = 'test-id';
process.env.GOOGLE_CLIENT_EMAIL = 'test@example.com';
process.env.GOOGLE_PRIVATE_KEY = 'test-key';

const { getServiceAmount } = require('../lib/sheets');

describe('getServiceAmount Security Hardening (P0-2)', () => {
  beforeEach(() => {
    mockSheetsValuesGet.mock.resetCalls();
  });

  test('requires exact case-insensitive match on the service name', async () => {
    mockSheetsValuesGet.mock.mockImplementationOnce(async () => ({
      data: {
        values: [
          ['ID', 'Name', 'Amount', 'Active'],
          ['1', 'Doctor Consultation', '400', 'TRUE'],
          ['2', 'Nutrition Consultation', '299', 'TRUE']
        ]
      }
    }));

    // Exact match works
    const amount = await getServiceAmount('doctor consultation', '');
    assert.strictEqual(amount, 400);
  });

  test('bidirectional substring match is rejected', async () => {
    mockSheetsValuesGet.mock.mockImplementationOnce(async () => ({
      data: {
        values: [
          ['ID', 'Name', 'Amount', 'Active'],
          ['1', 'Doctor Consultation', '400', 'TRUE'],
          ['2', 'Nutrition Consultation', '299', 'TRUE']
        ]
      }
    }));

    // Substring "nutrition" should NOT match "Nutrition Consultation"
    await assert.rejects(
      async () => await getServiceAmount('nutrition', ''),
      /Pricing not found for service: nutrition/
    );
  });

  test('enforces active flag (fails on inactive services)', async () => {
    mockSheetsValuesGet.mock.mockImplementationOnce(async () => ({
      data: {
        values: [
          ['ID', 'Name', 'Amount', 'Active'],
          ['3', 'Special Package', '500', 'FALSE']
        ]
      }
    }));

    await assert.rejects(
      async () => await getServiceAmount('Special Package', ''),
      /Pricing not found for service: Special Package/
    );
  });

  test('handles empty input gracefully', async () => {
    await assert.rejects(
      async () => await getServiceAmount('', ''),
      /Service name cannot be empty./
    );
  });

  test('does not fallback to 400 or static map if the service is not found', async () => {
    mockSheetsValuesGet.mock.mockImplementationOnce(async () => ({
      data: {
        values: [
          ['ID', 'Name', 'Amount', 'Active'],
          ['1', 'Doctor Consultation', '400', 'TRUE']
        ]
      }
    }));

    // If we request a fallback like "diet + workout plan" (which is 699 in the old static map),
    // it should fail now because it's not in the sheet.
    await assert.rejects(
      async () => await getServiceAmount('diet + workout plan', ''),
      /Pricing not found for service: diet \+ workout plan/
    );
  });

  test('throws database error if sheets fetch fails', async () => {
    mockSheetsValuesGet.mock.mockImplementationOnce(async () => {
      throw new Error('API Error');
    });

    await assert.rejects(
      async () => await getServiceAmount('Doctor Consultation', ''),
      /Failed to connect to pricing database./
    );
  });
});

const { updateBookingPaymentStatus } = require('../lib/sheets');

describe('updateBookingPaymentStatus Security Hardening (P0-4)', () => {
  test('fails closed if appointmentStatus is missing', async () => {
    // Missing appointmentStatus
    const res = await updateBookingPaymentStatus('b1', 'PAID', 'pay_1', 'ord_1');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.reason, 'missing_required_arguments');
  });

  test('fails closed if paymentStatus is missing', async () => {
    // Missing paymentStatus
    const res = await updateBookingPaymentStatus('b1');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.reason, 'missing_required_arguments');
  });

  test('executes a single atomic batchUpdate', async () => {
    mockSheetsValuesGet.mock.mockImplementationOnce(async () => ({
      data: {
        values: [['ID'], ['b1']]
      }
    }));
    mockSheetsValuesBatchUpdate.mock.resetCalls();

    const res = await updateBookingPaymentStatus('b1', 'PAID', 'pay_1', 'ord_1', 'CONFIRMED');
    assert.strictEqual(res.success, true);
    assert.strictEqual(mockSheetsValuesBatchUpdate.mock.calls.length, 1);
    
    const requestArgs = mockSheetsValuesBatchUpdate.mock.calls[0].arguments[0];
    assert.strictEqual(requestArgs.spreadsheetId, 'test-id');
    assert.strictEqual(requestArgs.requestBody.data.length, 3);
  });
});

