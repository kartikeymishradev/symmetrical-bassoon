/**
 * REVA Health — In-Memory Per-IP Rate Limiter Helper
 * Protects endpoints against basic single-instance spam attacks (e.g. max 10 requests per minute per IP).
 */

const ipStore = new Map();

function checkRateLimit(req, maxRequests = 10, windowMs = 60 * 1000) {
  const ip = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip']))
    || (req.socket && req.socket.remoteAddress)
    || '127.0.0.1';

  const clientIp = String(ip).split(',')[0].trim();
  const now = Date.now();

  const record = ipStore.get(clientIp) || { count: 0, resetTime: now + windowMs };

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
  } else {
    record.count += 1;
  }

  ipStore.set(clientIp, record);

  if (record.count > maxRequests) {
    return { limited: true, clientIp, remaining: 0, resetInSec: Math.ceil((record.resetTime - now) / 1000) };
  }

  return { limited: false, clientIp, remaining: maxRequests - record.count };
}

module.exports = { checkRateLimit };
