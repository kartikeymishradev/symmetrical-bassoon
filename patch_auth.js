const fs = require('fs');
let code = fs.readFileSync('api/admin/bookings.js', 'utf8');

const target = 'function verifyAdminAuth(req) {\n  const secretKey = process.env.ADMIN_SECRET_KEY;';
const replacement = 'function verifyAdminAuth(req) {\n  const secretKey = process.env.ADMIN_SECRET_KEY;\n  const adminEmail = process.env.ADMIN_EMAIL;';
code = code.replace(target, replacement);

const target2 = `  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, error: 'UNAUTHORIZED' };
  }

  return { valid: true };`;

const replacement2 = `  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, error: 'UNAUTHORIZED' };
  }

  if (adminEmail) {
    const providedEmail = req.headers['x-admin-email'];
    if (!providedEmail || providedEmail.toLowerCase().trim() !== adminEmail.toLowerCase().trim()) {
      return { valid: false, error: 'UNAUTHORIZED' };
    }
  }

  return { valid: true };`;

code = code.replace(target2, replacement2);
fs.writeFileSync('api/admin/bookings.js', code);
console.log('Bookings API updated.');
