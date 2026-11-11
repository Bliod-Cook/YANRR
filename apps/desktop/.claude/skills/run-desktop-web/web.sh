#!/usr/bin/env bash
# `start` serves the web client on http://localhost:2233, forwarding /api to $VITE_DEV_PROXY_TARGET; `stop` stops it.
set -euo pipefail
cd "$(dirname "$0")/../../.."
STATE=${YANRR_WEB_DIR:-${TMPDIR:-${TEMP:-/tmp}}/yanrr-web}
TARGET=${VITE_DEV_PROXY_TARGET:-http://127.0.0.1:3100}

case "${1:-}" in
start)
  mkdir -p "$STATE"
  VITE_DEV_PROXY_TARGET=$TARGET nohup pnpm run dev:web > "$STATE/vite.log" 2>&1 &
  for _ in $(seq 240); do
    if [ "$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' http://localhost:2233/)" = 200 ]; then
      echo "web client on http://localhost:2233, /api -> $TARGET, log in $STATE/vite.log"
      exit 0
    fi
    sleep 1
  done
  echo "Vite did not answer; see $STATE/vite.log" >&2
  exit 1
  ;;
stop)
  # pnpm runs Vite as a child process, so stop whatever listens on the port, children included.
  if command -v taskkill >/dev/null; then
    for pid in $(netstat -ano | awk '/:2233 .*LISTENING/ { print $NF }' | sort -u); do
      taskkill //PID "$pid" //T //F >/dev/null
    done
  else
    lsof -ti tcp:2233 -s tcp:listen | xargs -r kill
  fi
  echo stopped
  ;;
*)
  echo "usage: $0 start|stop" >&2
  exit 2
  ;;
esac
