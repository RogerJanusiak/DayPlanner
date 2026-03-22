const http = require('http');
const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');

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
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
};

// ── Server ────────────────────────────────────────────────────
const server = http.createServer((req, res) => {

  // CORS headers (lets the page call the API from the same origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── POST /notify  — fire a native macOS notification ─────
  if (req.method === 'POST' && req.url === '/notify') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { title, message } = JSON.parse(body);
        const safe = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        exec(`osascript -e 'display notification "${safe(message)}" with title "${safe(title)}"'`);
        exec('afplay /System/Library/Sounds/Glass.aiff');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  // ── POST /save-image  — save pasted image to disk ────────
  if (req.method === 'POST' && req.url === '/save-image') {
    const chunks = [];
    req.on('data', chunk => { chunks.push(chunk); });
    req.on('end', () => {
      try {
        const { data, filename, project, yearMonth } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const matches = data.match(/^data:image\/(\w+);base64,(.+)$/s);
        if (!matches) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid image data' }));
          return;
        }
        const rawExt  = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const imgData = Buffer.from(matches[2], 'base64');

        // Sanitise each path component to prevent traversal; replace spaces with hyphens
        const safeProject  = (project  || 'misc').replace(/[^\w\s\-]/g, '').trim().replace(/\s+/g, '-') || 'misc';
        const safeMonth    = (yearMonth|| '').replace(/[^0-9\-]/g, '');
        const safeFilename = (filename || 'image').replace(/[^\w\-]/g, '') || 'image';

        const dir      = path.join(__dirname, 'images', safeProject, safeMonth);
        fs.mkdirSync(dir, { recursive: true });

        // Avoid overwriting: append a counter if the file already exists
        let fname = `${safeFilename}.${rawExt}`;
        let counter = 1;
        while (fs.existsSync(path.join(dir, fname))) {
          fname = `${safeFilename}-${counter++}.${rawExt}`;
        }
        fs.writeFileSync(path.join(dir, fname), imgData);

        const urlPath = `images/${safeProject}/${safeMonth}/${fname}`;
        console.log(`\n[image] Saved ${urlPath}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: urlPath }));
      } catch (err) {
        console.error('\nImage save error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

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

  // ── GET static files (html, css, js, images/…) ───────────
  if (req.method === 'GET') {
    let rawUrl = req.url === '/' ? '/day-planner.html' : req.url.split('?')[0];
    try { rawUrl = decodeURIComponent(rawUrl); } catch (_) {}
    // For root-level assets keep the basename-only behaviour; for images/ allow the subpath
    const urlPath  = rawUrl.startsWith('/images/') ? rawUrl : `/${path.basename(rawUrl)}`;
    const filePath = path.resolve(path.join(__dirname, urlPath));
    // Path-traversal guard
    if (!filePath.startsWith(path.resolve(__dirname))) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    } catch (err) {
      res.writeHead(404);
      res.end(`Not found: ${rawUrl}`);
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
