#!/bin/bash
# ─────────────────────────────────────────────
#  Day Planner — Start
#  Starts the server in the background and
#  opens the app in your default browser.
# ─────────────────────────────────────────────

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$DIR/.server.pid"
LOG_FILE="$DIR/.server.log"
PORT=3000

# Check if already running
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "✅ Server already running (PID $OLD_PID) — opening browser..."
    open "http://localhost:$PORT"
    exit 0
  else
    rm "$PID_FILE"
  fi
fi

# Start server
echo "🚀 Starting Day Planner server..."
nohup node "$DIR/server.js" &
disown
SERVER_PID=$!
echo $SERVER_PID > "$PID_FILE"

# Wait briefly for server to be ready
sleep 1

# Verify it started
if kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "✅ Server started (PID $SERVER_PID)"
  echo "📂 Logs: $LOG_FILE"
  echo "🌐 Opening http://localhost:$PORT ..."
  open "http://localhost:$PORT"
else
  echo "❌ Server failed to start. Check logs:"
  cat "$LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi
