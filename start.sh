#!/usr/bin/env bash
# NexusTrack — Dev Server Startup Script
# Usage: ./start.sh

set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       NexusTrack — Full-Stack App        ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check Python
if ! command -v python3 &>/dev/null; then
  echo "❌  Python 3 is required. Install it and try again."
  exit 1
fi

# Check Flask
if ! python3 -c "import flask" &>/dev/null; then
  echo "❌  Flask not found. Install with:"
  echo "    pip install flask werkzeug pyjwt itsdangerous"
  exit 1
fi

# Load .env if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
  echo "✓  Loaded .env"
fi

# Set defaults
export PORT=${PORT:-5000}
export FLASK_ENV=${FLASK_ENV:-development}

echo "✓  Starting server on port $PORT"
echo "✓  Environment: $FLASK_ENV"
echo ""
echo "   Frontend: http://localhost:$PORT"
echo "   API:      http://localhost:$PORT/api"
echo "   Health:   http://localhost:$PORT/api/health"
echo ""

cd "$(dirname "$0")/backend"
python3 app.py
