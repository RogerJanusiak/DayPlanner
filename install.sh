#!/bin/bash
# ─────────────────────────────────────────────
#  Day Planner — Install
#  Sets up everything needed to run Day Planner
#  on macOS. Run this once.
# ─────────────────────────────────────────────

set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       Day Planner — Installer        ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── 1. Check for Node.js ──────────────────────────────────────
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  echo "✅ Node.js already installed: $NODE_VER"
else
  echo "⚙️  Node.js not found. Installing via Homebrew..."

  # Check for Homebrew
  if ! command -v brew &>/dev/null; then
    echo "⚙️  Homebrew not found. Installing Homebrew first..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add Homebrew to PATH for Apple Silicon Macs
    if [ -f "/opt/homebrew/bin/brew" ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
  else
    echo "✅ Homebrew already installed."
  fi

  brew install node
  echo "✅ Node.js installed: $(node --version)"
fi

# ── 2. Verify server.js is present ───────────────────────────
if [ ! -f "$DIR/server.js" ]; then
  echo "❌ server.js not found in $DIR"
  echo "   Make sure server.js and day-planner.html are in the same folder."
  exit 1
fi
echo "✅ server.js found"

# ── 3. Verify day-planner.html is present ────────────────────
if [ ! -f "$DIR/day-planner.html" ]; then
  echo "❌ day-planner.html not found in $DIR"
  exit 1
fi
echo "✅ day-planner.html found"

# ── 4. Make scripts executable ───────────────────────────────
chmod +x "$DIR/start.sh" 2>/dev/null && echo "✅ start.sh is executable" || true
chmod +x "$DIR/stop.sh"  2>/dev/null && echo "✅ stop.sh is executable"  || true
chmod +x "$DIR/install.sh" 2>/dev/null || true

# ── 5. Done ───────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════╗"
echo "║         Installation complete!       ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "  To start Day Planner:"
echo "    ./start.sh"
echo ""
echo "  To stop it:"
echo "    ./stop.sh"
echo ""
echo "  Your data will be auto-saved to:"
echo "    $DIR/day-planner-backup.yaml"
echo ""
