const fs = require('fs');
let text = fs.readFileSync('.env', 'utf8');
// Use a generic regex to wrap SMTP_PASS in quotes if it starts with #
const passMatch = text.match(/SMTP_PASS=(#.*)/);
if (passMatch && !passMatch[1].startsWith('"')) {
  text = text.replace(passMatch[0], 'SMTP_PASS="' + passMatch[1] + '"');
  fs.writeFileSync('.env', text, 'utf8');
}
