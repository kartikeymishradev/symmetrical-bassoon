const fs = require('fs');
 // Note: if glob is not installed, I'll use a basic find function.

function findHtmlFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const stat = fs.statSync(dir + '/' + file);
    if (stat.isDirectory() && file !== 'node_modules' && file !== '.git') {
      findHtmlFiles(dir + '/' + file, fileList);
    } else if (file.endsWith('.html') && !dir.includes('admin')) {
      fileList.push(dir + '/' + file);
    }
  }
  return fileList;
}

const htmlFiles = findHtmlFiles('.');
console.log('Found HTML files:', htmlFiles);

const socialHtml = `
          <div class="social-links" style="display: flex; gap: 8px; margin-top: 16px;">
            <a href="https://instagram.com/" target="_blank" rel="noopener noreferrer" aria-label="Follow us on Instagram" class="social-link" style="display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: #0B6B62; color: white; border-radius: 6px; text-decoration: none; transition: opacity 0.2s ease;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
              </svg>
            </a>
            <a href="https://facebook.com/" target="_blank" rel="noopener noreferrer" aria-label="Follow us on Facebook" class="social-link" style="display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: #0B6B62; color: white; border-radius: 6px; text-decoration: none; transition: opacity 0.2s ease;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
            </a>
            <a href="https://youtube.com/" target="_blank" rel="noopener noreferrer" aria-label="Subscribe to our YouTube channel" class="social-link" style="display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: #0B6B62; color: white; border-radius: 6px; text-decoration: none; transition: opacity 0.2s ease;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.5 12 3.5 12 3.5s-7.505 0-9.377.55a3.016 3.016 0 0 0-2.122 2.136C0 8.07 0 12 0 12s0 3.93.498 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.55 9.376.55 9.376.55s7.505 0 9.377-.55a3.016 3.016 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.498-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
            </a>
          </div>`;

for (const file of htmlFiles) {
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('<div class="footer-contacts">')) {
    // Check if we already injected it
    if (!html.includes('class="social-links"')) {
      html = html.replace(
        '</div>\n      </div>\n\n      <div class="footer-trust-grid">',
        `${socialHtml}\n        </div>\n      </div>\n\n      <div class="footer-trust-grid">`
      );
      // Wait, let's look at the actual source to be precise. Let's do a more generic replace.
      // Better to insert it right before the closing div of footer-contacts.
      
      const parts = html.split('<div class="footer-contacts">');
      if (parts.length > 1) {
        let inside = parts[1];
        let endIdx = inside.indexOf('</div>\n      </div>');
        if (endIdx === -1) {
          endIdx = inside.indexOf('</div>\r\n      </div>');
        }
        if (endIdx > -1) {
          const newInside = inside.slice(0, endIdx) + socialHtml + '\n        ' + inside.slice(endIdx);
          html = parts[0] + '<div class="footer-contacts">' + newInside;
          fs.writeFileSync(file, html);
          console.log('Injected into ' + file);
        } else {
           // Fallback to inserting after WhatsApp.
           const fallback = html.indexOf('</div>', html.indexOf('WhatsApp:'));
           if(fallback > -1) {
               html = html.slice(0, fallback+6) + socialHtml + html.slice(fallback+6);
               fs.writeFileSync(file, html);
               console.log('Injected via fallback into ' + file);
           }
        }
      }
    }
  }
}
