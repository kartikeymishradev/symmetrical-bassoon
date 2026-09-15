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

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Handle Serverless API Routes
  if (pathname === '/api/enquiry') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        req.body = body;
        enquiryHandler(req, createResWrapper(res));
      });
    } else {
      enquiryHandler(req, createResWrapper(res));
    }
    return;
  }

  if (pathname === '/api/support') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        req.body = body;
        supportHandler(req, createResWrapper(res));
      });
    } else {
      supportHandler(req, createResWrapper(res));
    }
    return;
  }

  // Handle Static File Serving
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(__dirname, '404.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404 Not Found</h1>');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
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
server.listen(PORT, () => {
  console.log(`REVA Health server running at http://localhost:${PORT}`);
});
