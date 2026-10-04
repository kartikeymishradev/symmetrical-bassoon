const fs = require('fs');
let html = fs.readFileSync('admin/index.html', 'utf8');

const headEnd = html.indexOf('</style>');
const styleInject = `
    #login-gate { position: fixed; inset: 0; background: var(--bg); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 20px; }
    .login-card { background: var(--card); padding: 40px 30px; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); width: 100%; max-width: 380px; text-align: center; border-top: 4px solid var(--teal); }
    .login-card h2 { margin-bottom: 8px; font-weight: 800; color: var(--text); font-size: 1.4rem; letter-spacing: -0.02em; }
    .login-card p { margin-bottom: 24px; color: var(--muted); font-size: 0.9rem; }
    .login-input { width: 100%; padding: 12px; margin-bottom: 16px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.95rem; }
    .login-btn { width: 100%; padding: 12px; background: #0B6B62; color: white; border: none; border-radius: 6px; font-size: 1rem; font-weight: 700; cursor: pointer; transition: background 0.2s; }
    .login-btn:hover:not(:disabled) { background: #09504a; }
    .login-btn:disabled { opacity: 0.7; cursor: not-allowed; }
    .login-error { color: #dc2626; font-size: 0.85rem; margin-top: 12px; display: none; font-weight: 500; }
`;
html = html.slice(0, headEnd) + styleInject + html.slice(headEnd);

const bodyStart = html.indexOf('<body>') + 6;
const loginHtml = `
  <div id="login-gate">
    <div class="login-card">
      <h2>REVA Health</h2>
      <p>Secure Admin Dashboard</p>
      <input type="email" id="gateEmail" class="login-input" placeholder="Admin email (optional)">
      <input type="password" id="gateSecret" class="login-input" placeholder="Admin secret key">
      <button class="login-btn" id="gateBtn" onclick="attemptLogin()">Unlock Dashboard</button>
      <div id="gateError" class="login-error">Incorrect email or secret key</div>
    </div>
  </div>
  <div id="dashboard-content" style="display: none;">
`;
html = html.slice(0, bodyStart) + loginHtml + html.slice(bodyStart);

const authBoxStart = html.indexOf('<div class="auth-box">');
const authBoxEnd = html.indexOf('</div>', authBoxStart) + 6;
const newAuthBox = `
      <div class="auth-box" style="background: transparent; box-shadow: none; backdrop-filter: none; padding: 0;">
        <button class="btn-refresh" onclick="logout()" style="background: rgba(255,255,255,0.2);">Lock / Logout</button>
      </div>
`;
html = html.slice(0, authBoxStart) + newAuthBox + html.slice(authBoxEnd);

const modalStart = html.indexOf('<!-- Update Status Modal -->');
html = html.slice(0, modalStart) + '  </div>\n\n  ' + html.slice(modalStart);

// Be precise with the JS slice
const jsStart1 = html.indexOf("const secretInput = document.getElementById('adminSecret');");
const jsEnd1 = html.indexOf('const COLORS = ');

const newJs1 = `
    function getAuthHeaders() {
      return {
        'x-admin-secret': sessionStorage.getItem('reva_admin_secret') || '',
        'x-admin-email': sessionStorage.getItem('reva_admin_email') || ''
      };
    }

    function logout() {
      sessionStorage.removeItem('reva_admin_secret');
      sessionStorage.removeItem('reva_admin_email');
      document.getElementById('dashboard-content').style.display = 'none';
      document.getElementById('login-gate').style.display = 'flex';
      document.getElementById('gateSecret').value = '';
      document.getElementById('gateBtn').textContent = 'Unlock Dashboard';
      document.getElementById('gateBtn').disabled = false;
      document.getElementById('gateError').style.display = 'none';
    }

    async function attemptLogin(isAuto = false) {
      const secret = document.getElementById('gateSecret').value.trim();
      const email = document.getElementById('gateEmail').value.trim();
      
      if (!secret && !isAuto) {
        const err = document.getElementById('gateError');
        err.textContent = 'Secret key is required';
        err.style.display = 'block';
        return;
      }
      
      const btn = document.getElementById('gateBtn');
      btn.textContent = 'Verifying...';
      btn.disabled = true;
      document.getElementById('gateError').style.display = 'none';

      sessionStorage.setItem('reva_admin_secret', secret);
      sessionStorage.setItem('reva_admin_email', email);

      const success = await loadDashboard(true);
      
      if (success) {
        document.getElementById('login-gate').style.display = 'none';
        document.getElementById('dashboard-content').style.display = 'block';
        btn.textContent = 'Unlock Dashboard';
        btn.disabled = false;
      } else {
        if (isAuto) {
          sessionStorage.removeItem('reva_admin_secret');
        } else {
          document.getElementById('gateError').textContent = 'Incorrect email or secret key';
          document.getElementById('gateError').style.display = 'block';
        }
        btn.textContent = 'Unlock Dashboard';
        btn.disabled = false;
      }
    }

    window.addEventListener('DOMContentLoaded', () => {
      const savedSecret = sessionStorage.getItem('reva_admin_secret');
      const savedEmail = sessionStorage.getItem('reva_admin_email');
      if (savedSecret) {
        document.getElementById('gateSecret').value = savedSecret;
        if (savedEmail) document.getElementById('gateEmail').value = savedEmail;
        attemptLogin(true);
      }
    });

    `;
html = html.slice(0, jsStart1) + newJs1 + html.slice(jsEnd1);

const loadDashStart = html.indexOf('async function loadDashboard() {');
const loadDashEnd = html.indexOf('function updateStats(bookings, payments)');

const newLoadDash = `async function loadDashboard(isLoginAttempt = false) {
      try {
        const res = await fetch('/api/admin/bookings', { headers: getAuthHeaders() });
        if (res.status === 401) { 
          if (!isLoginAttempt) showToast('Unauthorized: Incorrect credentials', true); 
          return false; 
        }
        const data = await res.json();
        if (!data.success) { 
          if (!isLoginAttempt) showToast(data.error || 'Failed to fetch data', true); 
          return false; 
        }
        
        const bookings = data.bookings || [], payments = data.payments || [];
        renderBookings(bookings);
        renderPayments(payments);
        
        const alerts = bookings.filter(b => b.appointment_status === 'PAID_SLOT_CONFLICT' || b.appointment_status === 'SLOT_EXPIRED');
        const alertBody = document.getElementById('alertsTable');
        if (alertBody) {
          if (alerts.length === 0) alertBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);">No alerts</td></tr>';
          else alertBody.innerHTML = alerts.map(b => '<tr><td>'+escapeHtml(b.booking_id)+'</td><td>'+escapeHtml(b.patient_name)+'</td><td>'+escapeHtml(b.phone_number)+'</td><td>₹'+escapeHtml(b.amount)+'</td><td style="color:#be123c;">'+escapeHtml(b.appointment_status)+'</td></tr>').join('');
        }
        
        if (document.getElementById('tab-settings').classList.contains('active')) loadSettings();
        
        updateStats(bookings, payments);
        renderCharts(bookings, payments);
        if (!isLoginAttempt) showToast('Dashboard loaded');
        return true;
      } catch (err) {
        if (!isLoginAttempt) showToast('Network error loading dashboard', true);
        console.error(err);
        return false;
      }
    }

    `;
html = html.slice(0, loadDashStart) + newLoadDash + html.slice(loadDashEnd);

fs.writeFileSync('admin/index.html', html);
console.log('Successfully injected login gate');
