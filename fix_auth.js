const fs = require('fs');
let code = fs.readFileSync('api/admin/bookings.js', 'utf8');

const newAuth = `function verifyAdminAuth(req) {
  const secretKey = process.env.ADMIN_SECRET_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!secretKey) return { valid: false, error: 'ADMIN_SECRET_KEY_NOT_SET' };
  const providedSecret = req.headers['x-admin-secret'];
  if (!providedSecret || typeof providedSecret !== 'string') return { valid: false, error: 'UNAUTHORIZED' };
  const expectedBuf = Buffer.from(secretKey, 'utf8');
  const actualBuf = Buffer.from(providedSecret, 'utf8');
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) return { valid: false, error: 'UNAUTHORIZED' };
  if (adminEmail) {
    const providedEmail = req.headers['x-admin-email'];
    if (!providedEmail || providedEmail.toLowerCase().trim() !== adminEmail.toLowerCase().trim()) return { valid: false, error: 'UNAUTHORIZED' };
  }
  return { valid: true };
}`;

const authStart = code.indexOf('function verifyAdminAuth(req) {');
const authEnd = code.indexOf('module.exports = async function handler');

if (authStart > -1 && authEnd > -1) {
  code = code.slice(0, authStart) + newAuth + '\n\n' + code.slice(authEnd);
  fs.writeFileSync('api/admin/bookings.js', code);
  console.log('Successfully updated bookings.js auth function');
} else {
  console.log('Could not find auth block bounds');
}
