const fs = require('fs');
let html = fs.readFileSync('admin/index.html', 'utf8');

const overlayHtml = `
  <div id="login-overlay" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #0b0b0b; z-index: 99999; display: flex; flex-direction: column; align-items: center; justify-content: center; color: white; font-family: 'Plus Jakarta Sans', sans-serif;">
    <h2 style="margin-bottom: 24px; font-weight: 800; font-size: 24px;">REVA Health Secure Admin</h2>
    <input type="email" id="admin-email" placeholder="Admin Email" style="padding: 14px 16px; margin-bottom: 12px; border-radius: 8px; border: 1px solid #333; width: 300px; font-size: 15px; background: #1a1a1a; color: white; outline: none;" />
    <input type="password" id="admin-pass" placeholder="Admin Secret Key" style="padding: 14px 16px; margin-bottom: 24px; border-radius: 8px; border: 1px solid #333; width: 300px; font-size: 15px; background: #1a1a1a; color: white; outline: none;" />
    <button onclick="performLogin()" style="padding: 14px 24px; background: #0284c7; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; width: 300px; font-size: 16px; transition: background 0.2s;">Unlock Dashboard</button>
    <p id="login-error" style="color: #f43f5e; margin-top: 16px; display: none; font-weight: 500;">Incorrect Email or Secret Key</p>
  </div>
`;

if (!html.includes('id="login-overlay"')) {
  html = html.replace('<body>', '<body style="overflow: hidden; visibility: hidden;">' + overlayHtml);
}

const loginLogic = `
  <script>
    document.addEventListener('DOMContentLoaded', () => {
      document.body.style.visibility = 'visible';
      const savedEmail = localStorage.getItem('reva_admin_email');
      const savedPass = localStorage.getItem('reva_admin_secret');
      if (savedEmail && savedPass) {
        document.getElementById('admin-email').value = savedEmail;
        document.getElementById('admin-pass').value = savedPass;
        performLogin(true);
      }
    });

    async function performLogin(silent = false) {
      const email = document.getElementById('admin-email').value.trim();
      const pass = document.getElementById('admin-pass').value.trim();
      if (!email || !pass) {
        if (!silent) document.getElementById('login-error').style.display = 'block';
        return;
      }
      
      const btn = document.querySelector('#login-overlay button');
      const oldText = btn.innerText;
      btn.innerText = 'Verifying...';
      document.getElementById('login-error').style.display = 'none';

      try {
        const res = await fetch('/api/admin/bookings', {
          headers: {
            'x-admin-secret': pass,
            'x-admin-email': email
          }
        });

        if (res.ok || res.status === 200) {
          localStorage.setItem('reva_admin_email', email);
          localStorage.setItem('reva_admin_secret', pass);
          document.getElementById('login-overlay').style.display = 'none';
          document.body.style.overflow = 'auto';
          
          const oldInput = document.getElementById('secretInput');
          if (oldInput) oldInput.value = pass;
          
          if (typeof fetchBookings === 'function') {
            fetchBookings();
          }
        } else {
          throw new Error('Auth failed');
        }
      } catch (err) {
        if (!silent) {
          document.getElementById('login-error').style.display = 'block';
          localStorage.removeItem('reva_admin_email');
          localStorage.removeItem('reva_admin_secret');
        }
      } finally {
        btn.innerText = oldText;
      }
    }
  </script>
`;

if (!html.includes('performLogin')) {
  html = html.replace('</head>', loginLogic + '\n</head>');
}
fs.writeFileSync('admin/index.html', html);
console.log('Modified admin/index.html');
