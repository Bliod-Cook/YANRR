#!/usr/bin/env bash
# Stops what start.sh started; `--clean` also deletes the database and logs.
set -uo pipefail
STATE=${YANRR_RUN_DIR:-${TMPDIR:-${TEMP:-/tmp}}/yanrr-run}
[ -f "$STATE/server.pid" ] && kill "$(cat "$STATE/server.pid")" 2>/dev/null
rm -f "$STATE/server.pid"
[ -f "$STATE/pg_bin" ] && "$(cat "$STATE/pg_bin")/pg_ctl" -D "$STATE/pg" -m fast stop >/dev/null 2>&1
[ "${1:-}" = --clean ] && rm -rf "$STATE"
echo stopped
