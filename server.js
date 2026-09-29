/**
 * REVA Health — Local Development & API Server
 *
 * Serves static web assets and handles serverless API routes (/api/enquiry, /api/support).
 * Loads environment variables from .env if present.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...vals] = trimmed.split('=');
      process.env[key.trim()] = vals.join('=').trim();
    }
  });
}

const enquiryHandler = require('./api/enquiry');
const supportHandler = require('./api/support');
const servicesHandler = require('./api/services');
const slotsHandler = require('./api/slots');
const createOrderHandler = require('./api/create-order');
const verifyPaymentHandler = require('./api/verify-payment');
const webhookRazorpayHandler = require('./api/webhook-razorpay');
const adminBookingsHandler = require('./api/admin/bookings');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Helper for processing POST/GET requests to Vercel-style handlers
  const handleApi = (handler) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      let body = '';
      let tooLarge = false;
      req.on('data', chunk => {
        if (tooLarge) return;
        body += chunk;
        if (Buffer.byteLength(body) > 100 * 1024) {
          tooLarge = true;
          res.statusCode = 413;
          res.end('Payload Too Large');
          req.connection.destroy();
        }
      });
      req.on('end', () => {
        if (tooLarge) return;
        req.body = body;
        handler(req, createResWrapper(res));
      });
    } else {
      handler(req, createResWrapper(res));
    }
  };

  // Handle Serverless API Routes
  if (pathname === '/api/enquiry') return handleApi(enquiryHandler);
  if (pathname === '/api/support') return handleApi(supportHandler);
  if (pathname === '/api/services') return handleApi(servicesHandler);
  if (pathname === '/api/slots') return handleApi(slotsHandler);
  if (pathname === '/api/create-order') return handleApi(createOrderHandler);
  if (pathname === '/api/verify-payment') return handleApi(verifyPaymentHandler);
  if (pathname === '/api/webhook-razorpay') return handleApi(webhookRazorpayHandler);
  if (pathname === '/api/admin/bookings') return handleApi(adminBookingsHandler);

  // Block dotfiles (e.g. /.env, /.git)
  if (pathname.split('/').some(segment => segment.startsWith('.'))) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Forbidden');
  }

  // Handle Static File Serving with Clean URLs Support
  // Prevent path traversal by normalizing and safely resolving relative to __dirname
  const safePathname = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(__dirname, safePathname === '/' || safePathname === '\\' ? 'index.html' : safePathname);
  
  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(filePath + '.html')) {
      filePath = filePath + '.html';
    } else if (fs.existsSync(path.join(filePath, 'index.html'))) {
      filePath = path.join(filePath, 'index.html');
    } else if (fs.existsSync(path.join(__dirname, '404.html'))) {
      filePath = path.join(__dirname, '404.html');
      res.statusCode = 404;
    } else {
      filePath = path.join(__dirname, 'index.html');
    }
  } else if (fs.statSync(filePath).isDirectory()) {
    if (fs.existsSync(path.join(filePath, 'index.html'))) {
      filePath = path.join(filePath, 'index.html');
    } else {
      filePath = path.join(__dirname, 'index.html');
    }
  }

  // Enforce Allowlist for Static Assets
  // Only serve files from allowed public directories or specific public root files
  const allowedDirectories = ['css', 'js', 'assets', 'admin'];
  const allowedRootFiles = ['index.html', 'blog.html', '404.html', 'favicon.ico', 'robots.txt', 'sitemap.xml'];
  
  // Calculate relative path from __dirname to the resolved filePath
  const relativePath = path.relative(__dirname, filePath);
  const pathParts = relativePath.split(path.sep);
  const topLevel = pathParts[0];

  // Prevent serving anything outside __dirname (path traversal catch-all)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Forbidden');
  }

  // Check allowlist
  const isAllowed = allowedDirectories.includes(topLevel) || (pathParts.length === 1 && allowedRootFiles.includes(topLevel));
  if (!isAllowed) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Forbidden: Not a public asset');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('<h1>Server Error</h1>');
    } else {
      if (!res.statusCode) res.statusCode = 200;
      res.writeHead(res.statusCode, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

function createResWrapper(res) {
  return {
    setHeader: (key, val) => res.setHeader(key, val),
    status: (statusCode) => {
      res.statusCode = statusCode;
      return {
        json: (data) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        },
        end: () => res.end()
      };
    }
  };
}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`REVA Health server running at http://${HOST}:${PORT}`);
});
