/**
 * Helper to build "Click to WhatsApp" (wa.me) links
 */

function buildWhatsAppLink(phone, message) {
  const digitsOnly = String(phone || '').replace(/[^0-9]/g, '');
  if (!digitsOnly) return '';
  
  let withCountryCode = digitsOnly;
  if (digitsOnly.length === 10) {
    withCountryCode = `91${digitsOnly}`;
  } else if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    withCountryCode = digitsOnly;
  } else {
    // Invalid length or format, fail gracefully by returning empty link
    return '';
  }
  
  const encodedMessage = encodeURIComponent(message || '');
  return `https://wa.me/${withCountryCode}?text=${encodedMessage}`;
}

module.exports = { buildWhatsAppLink };
