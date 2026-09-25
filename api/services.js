/**
 * Serverless API Endpoint: REVA Health Services Catalog
 * Route: GET /api/services
 *
 * Fetches available consultation packages and pricing from the Google Sheets
 * 'Services' tab (A:D). Provides a safe fallback if unconfigured or empty.
 */

const { fetchServices } = require('../lib/sheets');

const FALLBACK_SERVICES = [
  { service_id: 'SRV-DOC-400', service_name: 'Doctor Consultation', amount: 400, active: true },
  { service_id: 'SRV-NUT-299', service_name: 'Nutrition Consultation', amount: 299, active: true },
  { service_id: 'SRV-DIET-499', service_name: 'Personalised Diet Plan', amount: 499, active: true },
  { service_id: 'SRV-WORKOUT-699', service_name: 'Diet + Workout Plan', amount: 699, active: true },
  { service_id: 'SRV-COMBO-999', service_name: 'Doctor + Nutrition Combo Package', amount: 999, active: true }
];

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { success, services, error } = await fetchServices();

    if (success && services && services.length > 0) {
      return res.status(200).json({
        success: true,
        source: 'google_sheets',
        count: services.length,
        services: services
      });
    }

    // Safe fallback to static catalog
    return res.status(200).json({
      success: true,
      source: 'static_catalog',
      count: FALLBACK_SERVICES.length,
      services: FALLBACK_SERVICES,
      note: error ? 'Using default catalog due to Sheets fetch notice.' : 'Services sheet is currently unpopulated; returned default catalog.'
    });

  } catch (err) {
    console.error('Services handler error:', err.message || err);
    return res.status(200).json({
      success: true,
      source: 'static_fallback',
      count: FALLBACK_SERVICES.length,
      services: FALLBACK_SERVICES
    });
  }
};
