#!/bin/bash
# Start/stop/status for the local (non-Docker) dev server -- runs the backend
# directly via `bun run dev` (server/package.json: `bun --env-file ../.env
# --watch index.ts`), which also serves the frontend through Vite's
# middleware mode on the same port. Both backend (bun --watch) and frontend
# (Vite HMR) hot-reload on their own; this script just supervises the one
# process.
#
# NOTE: this intentionally bypasses the root `dev:backend`/`dev:frontend`
# scripts (dotenv-cli isn't installed in this environment, and a stray
# python `dotenv` CLI on PATH shadows it anyway) and runs server/package.json's
# own `dev` script directly, same as CLAUDE.md's documented `bun run dev` but
# without the Tauri desktop wrapper.
#
# NOTES FOR FUTURE SESSIONS:
#   - App: http://localhost:1111 (frontend+backend share one port, Vite
#     middleware mode). Logs: /tmp/blinko-journal-dev.log (`logs` tails it).
#   - .env (repo root, gitignored) points DATABASE_URL/OLLAMA_BASE_URL at
#     real remote infra over Tailscale -- this is a real seeded DB, so never
#     run `prisma migrate dev`/`reset` against it.
#   - Restart needed?: frontend (app/src) and backend/shared (server, shared,
#     prisma/seed.ts) code -- no, hot-reloads on save. .env changes -- yes.
#     Schema changes -- write a migration, `prisma:migrate:deploy`,
#     `prisma:generate`, then yes (the regenerated client isn't watched).
#     AI prompts/toggles via Settings UI -- no, read fresh from DB every
#     request. AI defaults edited as constants in prisma/seed.ts -- only
#     take effect on this already-seeded DB via `forceSetConfigOnce`, not
#     `setConfigIfMissing` (which no-ops once a row exists).
#   - Diagnosing: `grep -i error /tmp/blinko-journal-dev.log`; a failed
#     `start` dumps its own last 40 log lines automatically.
set -e

cd "$(dirname "$0")/.."

PID_FILE="/tmp/blinko-journal-dev.pid"
LOG_FILE="/tmp/blinko-journal-dev.log"
PORT=1111

usage() {
  echo "Usage: $0 {start|stop|status|restart|logs}"
  exit 1
}

# CUSTOM-JOURNAL: matches bun's actual argv exactly (server/package.json's
# `dev` script) so `pkill -f`/`pgrep -f` finds it reliably by command line
# rather than trusting a possibly-stale pidfile across reboots/crashes.
PROC_PATTERN="bun --env-file ../.env --watch index.ts"

is_running() {
  pgrep -f "$PROC_PATTERN" >/dev/null 2>&1
}

cmd_start() {
  if is_running; then
    echo "Already running. See: $0 status"
    exit 0
  fi
  if [ ! -f .env ]; then
    echo "No .env found at repo root -- copy .env.tmpl and fill in DATABASE_URL/NEXTAUTH_SECRET/etc first."
    exit 1
  fi

  echo "Starting dev server (backend + frontend HMR on http://localhost:${PORT})..."
  # nohup + disown, not setsid -- bash's $! here is bun's own PID directly
  # (no extra subshell/process-group indirection to get wrong), and nohup
  # alone is enough to survive this script exiting.
  (cd server && nohup bun run dev > "$LOG_FILE" 2>&1 & echo $! > "$PID_FILE")
  disown 2>/dev/null || true

  # Wait a bit and confirm it actually came up rather than dying immediately
  # (bad DATABASE_URL, port in use, etc.) -- report failure instead of
  # silently leaving a stale pidfile behind.
  for _ in $(seq 1 20); do
    if curl -sf -o /dev/null "http://localhost:${PORT}"; then
      echo "Up: http://localhost:${PORT}  (logs: $LOG_FILE)"
      return 0
    fi
    if ! is_running; then
      echo "Failed to start -- last 40 lines of $LOG_FILE:"
      tail -40 "$LOG_FILE"
      rm -f "$PID_FILE"
      exit 1
    fi
    sleep 1
  done
  echo "Still starting after 20s -- check: $0 status / $0 logs"
}

cmd_stop() {
  if ! is_running; then
    echo "Not running."
    rm -f "$PID_FILE"
    exit 0
  fi
  echo "Stopping..."
  pkill -f "$PROC_PATTERN" 2>/dev/null || true
  for _ in $(seq 1 10); do
    is_running || break
    sleep 1
  done
  if is_running; then
    echo "Still up after 10s, force-killing..."
    pkill -9 -f "$PROC_PATTERN" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "Stopped."
}

cmd_status() {
  if is_running; then
    if curl -sf -o /dev/null "http://localhost:${PORT}"; then
      echo "Running and responding on http://localhost:${PORT}"
    else
      echo "Process is up but not responding on port ${PORT} yet -- check: $0 logs"
    fi
  else
    echo "Not running."
  fi
}

case "$1" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status) cmd_status ;;
  logs) tail -100 -f "$LOG_FILE" ;;
  *) usage ;;
esac
