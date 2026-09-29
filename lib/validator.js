/**
 * Shared input validation logic to prevent malformed data, injection, or overflow attacks.
 */

function sanitizePhone(phone) {
  if (!phone) return null;
  // strip spaces, hyphens, parentheses
  return String(phone).replace(/[\s\-()]/g, '');
}

function isValidPhone(phone) {
  const sanitized = sanitizePhone(phone);
  if (!sanitized) return false;
  // Match exact 10 digits or +91 followed by 10 digits
  return /^(\+91)?\d{10}$/.test(sanitized);
}

function isValidEmail(email) {
  if (!email) return true; // Optional, so empty is considered valid for the format check itself
  const str = String(email).trim();
  if (str.length > 255) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

function isValidName(name) {
  if (!name) return false;
  const str = String(name).trim();
  if (str.length === 0 || str.length > 100) return false;
  // Allow letters, spaces, hyphens, apostrophes, and common diacritics
  return /^[\p{L}\s\-']+$/u.test(str);
}

function isValidDate(dateStr) {
  if (!dateStr) return false;
  const str = String(dateStr).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;

  const inputDate = new Date(str);
  if (isNaN(inputDate.getTime())) return false;

  // Verify logical window (today to today + 60 days)
  // Strip time for accurate comparison
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + 60);
  
  // Also strip time from inputDate to be sure (it should be 00:00:00 UTC anyway from YYYY-MM-DD)
  // We'll parse the YYYY-MM-DD as local time for the boundary check
  const [y, m, d] = str.split('-').map(Number);
  const localInput = new Date(y, m - 1, d);

  if (localInput < today || localInput > maxDate) {
    return false;
  }

  return true;
}

function isValidTime(timeStr) {
  if (!timeStr) return false;
  const str = String(timeStr).trim();
  // match HH:MM (24h) or HH:MM AM/PM
  return /^([01]?[0-9]|2[0-3]):[0-5][0-9](?:\s?[aApP][mM])?$/.test(str);
}

function isValidText(text, maxLength = 1000) {
  if (text === null || text === undefined) return true; // Optional text
  const str = String(text);
  if (str.length > maxLength) return false;
  return true;
}

module.exports = {
  sanitizePhone,
  isValidPhone,
  isValidEmail,
  isValidName,
  isValidDate,
  isValidTime,
  isValidText
};
