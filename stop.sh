#!/bin/bash
# ─────────────────────────────────────────────
#  Day Planner — Stop
#  Gracefully shuts down the background server.
# ─────────────────────────────────────────────

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$DIR/.server.pid"

# ── Shutdown backup ───────────────────────────────────────────
node -e "
const fs = require('fs'), path = require('path');
const src = path.join('$DIR', 'day-planner-backup.yaml');
if (!fs.existsSync(src)) { console.log('ℹ️  No data file to back up.'); process.exit(0); }
const now = new Date();
const yyyy = now.getFullYear();
const mm   = String(now.getMonth() + 1).padStart(2, '0');
const dd   = String(now.getDate()).padStart(2, '0');
const hh   = String(now.getHours()).padStart(2, '0');
const min  = String(now.getMinutes()).padStart(2, '0');
const dir  = path.join('$DIR', 'backups', String(yyyy), mm);
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'day-planner-' + yyyy + '-' + mm + '-' + dd + '_' + hh + '-' + min + '.yaml');
fs.copyFileSync(src, file);
console.log('💾 Shutdown backup saved to ' + path.relative('$DIR', file));
"

if [ ! -f "$PID_FILE" ]; then
  echo "ℹ️  No PID file found — server may not be running."
  # Try to kill by process name as fallback
  pkill -f "node server.js" 2>/dev/null && echo "🛑 Stopped any matching node server.js process." || echo "Nothing to stop."
  exit 0
fi

PID=$(cat "$PID_FILE")

if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  sleep 0.5
  if kill -0 "$PID" 2>/dev/null; then
    kill -9 "$PID"
    echo "🛑 Force-stopped server (PID $PID)"
  else
    echo "🛑 Server stopped (PID $PID)"
  fi
else
  echo "ℹ️  Server (PID $PID) was not running."
fi

rm -f "$PID_FILE"
