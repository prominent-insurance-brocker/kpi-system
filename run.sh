#!/usr/bin/env bash
# Run backend (Django) and frontend (Next.js) together.
# Usage: ./run.sh

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
  PYTHON="$BACKEND/.venv/Scripts/python.exe"
else
  PYTHON="$BACKEND/.venv/bin/python"
fi

if [[ ! -x "$PYTHON" ]]; then
  echo "Python venv not found at $PYTHON" >&2
  echo "Create it with: cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt" >&2
  exit 1
fi

cleanup() {
  echo ""
  echo "Stopping services..."
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting backend on http://localhost:8000 ..."
(cd "$BACKEND" && "$PYTHON" manage.py runserver) &
BACKEND_PID=$!

echo "Starting frontend on http://localhost:3000 ..."
(cd "$FRONTEND" && npm run dev) &
FRONTEND_PID=$!

wait
