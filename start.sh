#!/usr/bin/env bash
# Start the notepadpp-web dev server in the background (or preview server).
# Usage: ./start.sh [dev|preview]   (default: dev)
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

MODE="${1:-dev}"
case "$MODE" in
  dev)     PORT=5173 ;;
  preview) PORT=4173 ;;
  *) echo "usage: $0 [dev|preview]" >&2; exit 2 ;;
esac

PIDFILE=".server.$MODE.pid"
LOGFILE=".server.$MODE.log"
BIN="node_modules/.bin/vite"

if [ ! -x "$BIN" ]; then
  echo "vite not found at $BIN — run 'npm install' first" >&2
  exit 1
fi

# Already running?
if [ -f "$PIDFILE" ]; then
  PID="$(cat "$PIDFILE")"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "already running ($MODE, pid $PID) → http://localhost:$PORT"
    exit 0
  fi
  rm -f "$PIDFILE"  # stale pid file
fi

# Port taken by something else?
if (echo >/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
  echo "port $PORT is already in use by another process — not starting" >&2
  exit 1
fi

if [ "$MODE" = "preview" ] && [ ! -f dist/index.html ]; then
  echo "dist/ not built — run 'npm run build' first" >&2
  exit 1
fi

nohup "$BIN" "$MODE" --port "$PORT" --strictPort >"$LOGFILE" 2>&1 &
PID=$!
echo "$PID" >"$PIDFILE"

# Wait until the server answers (max ~15s)
for _ in $(seq 1 150); do
  if (echo >/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
    echo "started ($MODE, pid $PID) → http://localhost:$PORT"
    echo "logs: $PWD/$LOGFILE   stop with: ./stop.sh $MODE"
    exit 0
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "server exited during startup — see $LOGFILE:" >&2
    tail -n 20 "$LOGFILE" >&2
    rm -f "$PIDFILE"
    exit 1
  fi
  sleep 0.1
done

echo "server did not open port $PORT within 15s — see $LOGFILE" >&2
exit 1
