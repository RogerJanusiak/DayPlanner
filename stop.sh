#!/bin/bash
# ─────────────────────────────────────────────
#  Day Planner — Stop
#  Gracefully shuts down the background server.
# ─────────────────────────────────────────────

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$DIR/.server.pid"

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
