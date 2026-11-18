#!/usr/bin/env bash
# Stop the notepadpp-web server started by start.sh.
# Usage: ./stop.sh [dev|preview]   (default: dev; 'all' stops both)
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

stop_one() {
  local MODE="$1"
  local PIDFILE=".server.$MODE.pid"

  if [ ! -f "$PIDFILE" ]; then
    echo "not running ($MODE — no pid file)"
    return 0
  fi

  local PID
  PID="$(cat "$PIDFILE")"

  if [ -z "$PID" ] || ! kill -0 "$PID" 2>/dev/null; then
    echo "not running ($MODE — removed stale pid file)"
    rm -f "$PIDFILE"
    return 0
  fi

  kill "$PID"
  for _ in $(seq 1 50); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$PID" 2>/dev/null; then
    echo "$MODE (pid $PID) ignored SIGTERM — sending SIGKILL"
    kill -9 "$PID" 2>/dev/null || true
  fi

  rm -f "$PIDFILE"
  echo "stopped ($MODE, pid $PID)"
}

MODE="${1:-dev}"
case "$MODE" in
  dev|preview) stop_one "$MODE" ;;
  all)         stop_one dev; stop_one preview ;;
  *)           echo "usage: $0 [dev|preview|all]" >&2; exit 2 ;;
esac
