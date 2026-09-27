/**
 * REVA Health — Enhanced In-Memory Per-IP Rate Limiter Helper
 * 
 * Protects endpoints against single-instance spam attacks with:
 *  - Configurable limits & time windows
 *  - Automatic memory cleanup / cache eviction for expired entries
 *  - Standard HTTP rate-limit response headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)
 */

const ipStore = new Map();

/**
 * Purges expired IP entries from memory to prevent memory leaks over time.
 */
function purgeExpiredEntries(now) {
  if (ipStore.size < 100) return; // Only run purge pass when map size exceeds 100 IPs
  for (const [ip, record] of ipStore.entries()) {
    if (now > record.resetTime) {
      ipStore.delete(ip);
    }
  }
}

/**
 * Checks per-IP rate limit and sets standard X-RateLimit-* response headers.
 * 
 * Usage:
 *   const rateCheck = checkRateLimit(req, res, 10, 60000);
 *   if (rateCheck.limited) {
 *     return res.status(429).json({ error: `Too many requests. Please wait ${rateCheck.resetInSec} seconds.` });
 *   }
 */
function checkRateLimit(req, res, maxRequests = 10, windowMs = 60 * 1000) {
  const now = Date.now();
  purgeExpiredEntries(now);

  // Extract client IP (handle proxies & Vercel edge router headers)
  const ip = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip']))
    || (req.socket && req.socket.remoteAddress)
    || '127.0.0.1';

  const clientIp = String(ip).split(',')[0].trim();
  const record = ipStore.get(clientIp) || { count: 0, resetTime: now + windowMs };

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
  } else {
    record.count += 1;
  }

  ipStore.set(clientIp, record);

  const remaining = Math.max(0, maxRequests - record.count);
  const resetInSec = Math.ceil(Math.max(1, (record.resetTime - now) / 1000));
  const limited = record.count > maxRequests;

  // Set standard RateLimit HTTP headers on response if res object is provided
  if (res && typeof res.setHeader === 'function') {
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetInSec));
  }

  return { limited, clientIp, remaining, resetInSec };
}

module.exports = { checkRateLimit };
