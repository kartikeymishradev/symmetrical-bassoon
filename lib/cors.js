/**
 * REVA Health — Dynamic CORS Security Helper
 * 
 * Dynamically validates and echoes allowed origins to enforce strict cross-origin security.
 * Allowed Origins:
 *  - https://revahealth.in
 *  - https://www.revahealth.in
 *  - Any *.vercel.app domain (Preview & Production deployments)
 *  - Local development (http://localhost:*, http://127.0.0.1:*)
 */

function isAllowedOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  const lower = origin.toLowerCase().trim();

  // Production Domains
  if (lower === 'https://revahealth.in' || lower === 'https://www.revahealth.in') {
    return true;
  }

  // Any *.vercel.app preview or production deployment domain
  if (lower.endsWith('.vercel.app') && (lower.startsWith('https://') || lower.startsWith('http://'))) {
    return true;
  }

  // Local development origins
  if (lower.startsWith('http://localhost:') || lower.startsWith('http://127.0.0.1:') || lower === 'http://localhost' || lower === 'http://127.0.0.1') {
    return true;
  }

  return false;
}

/**
 * Dynamically sets CORS headers on the HTTP response object.
 */
function setCorsHeaders(req, res, options = {}) {
  const allowMethods = options.methods || 'GET, POST, OPTIONS';
  const allowHeaders = options.headers || 'Content-Type';
  const isAdmin = options.isAdmin || false;

  const origin = (req.headers && (req.headers.origin || req.headers.Origin)) || '';

  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin.trim());
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', allowMethods);
    res.setHeader('Access-Control-Allow-Headers', allowHeaders);
    return true;
  }

  // For Admin endpoints: strictly omit Access-Control-Allow-Origin if origin is not allowed
  if (!isAdmin) {
    // For public endpoints without an explicit matched Origin header (e.g. direct browser navigation), set default methods/headers
    res.setHeader('Access-Control-Allow-Methods', allowMethods);
    res.setHeader('Access-Control-Allow-Headers', allowHeaders);
  }

  return false;
}

module.exports = { isAllowedOrigin, setCorsHeaders };
