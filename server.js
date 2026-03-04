const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT      = 3000;
const HTML_FILE = path.join(__dirname, 'day-planner.html');
const SAVE_FILE = path.join(__dirname, 'day-planner-backup.yaml');

// ── MIME types ────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml':  'text/yaml; charset=utf-8',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.ico':  'image/x-icon',
};

// ── Server ────────────────────────────────────────────────────
const server = http.createServer((req, res) => {

  // CORS headers (lets the page call the API from the same origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── POST /save  — receive YAML and write to disk ──────────
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        fs.writeFileSync(SAVE_FILE, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        // Print a small timestamp so you can see saves happening in the terminal
        const t = new Date().toLocaleTimeString();
        process.stdout.write(`\r[${t}] Auto-saved to day-planner-backup.yaml`);
      } catch (err) {
        console.error('\nSave error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // ── GET /load  — send YAML back to the page ───────────────
  if (req.method === 'GET' && req.url === '/load') {
    if (fs.existsSync(SAVE_FILE)) {
      const data = fs.readFileSync(SAVE_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/yaml; charset=utf-8' });
      res.end(data);
    } else {
      res.writeHead(204); // no content — first run, no file yet
      res.end();
    }
    return;
  }

  // ── GET / or /day-planner.html  — serve the app ──────────
  if (req.method === 'GET' && (req.url === '/' || req.url === '/day-planner.html')) {
    try {
      const html = fs.readFileSync(HTML_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(404);
      res.end('day-planner.html not found — make sure server.js is in the same folder.');
    }
    return;
  }

  // ── Everything else → 404 ─────────────────────────────────
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nDay Planner running at http://localhost:${PORT}`);
  console.log(`Backups will be saved to: ${SAVE_FILE}`);
  console.log('Press Ctrl+C to stop.\n');
});
