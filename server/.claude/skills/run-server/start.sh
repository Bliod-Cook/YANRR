#!/usr/bin/env bash
# Starts a throwaway PostgreSQL and the server on http://127.0.0.1:$PORT, configured from the environment only.
set -euo pipefail
cd "$(dirname "$0")/../../.."
PORT=${PORT:-3100}
PG_PORT=${PG_PORT:-54329}
STATE=${YANRR_RUN_DIR:-${TMPDIR:-${TEMP:-/tmp}}/yanrr-run}

# PostgreSQL from PATH, or the one the integration tests download into ~/.theseus.
if command -v pg_ctl >/dev/null; then
  PG=$(dirname "$(command -v pg_ctl)")
else
  PG=$(ls -d "$HOME"/.theseus/postgresql/*/bin 2>/dev/null | tail -1)
fi
[ -n "$PG" ] || { echo "No PostgreSQL found: run 'cargo test --test api' once to download one" >&2; exit 1; }

mkdir -p "$STATE"
echo "$PG" > "$STATE/pg_bin"
# The C locale, as initdb finds no text search configuration for some system locales (e.g. Chinese Windows).
[ -d "$STATE/pg" ] || "$PG/initdb" -D "$STATE/pg" -U yanrr -A trust -E UTF8 --locale=C >/dev/null
"$PG/pg_ctl" -D "$STATE/pg" -o "-p $PG_PORT -h 127.0.0.1" -l "$STATE/pg.log" -w start >/dev/null
"$PG/createdb" -h 127.0.0.1 -p "$PG_PORT" -U yanrr yanrr 2>/dev/null || true

# Builds quietly: on Windows the linker prints hundreds of harmless LNK4099 warnings.
cargo build > "$STATE/build.log" 2>&1 || { grep -A5 '^error' "$STATE/build.log" >&2; exit 1; }
export YANRR_SERVER__LISTEN=127.0.0.1:$PORT
export YANRR_SERVER__PUBLIC_URL=http://127.0.0.1:$PORT
export YANRR_DATABASE__URL=postgres://yanrr@127.0.0.1:$PG_PORT/yanrr
export YANRR_AUTH__SECRET=run-skill-secret-that-is-at-least-32-characters
export YANRR_SEARCH__DIR=$STATE/search
# A config path that does not exist, so a developer's config.toml is left out.
nohup ./target/debug/yanrr "$STATE/none.toml" > "$STATE/server.log" 2>&1 &
echo $! > "$STATE/server.pid"
for _ in $(seq 120); do
  if curl -sf --noproxy '*' "http://127.0.0.1:$PORT/api/status/configs" >/dev/null; then
    echo "server on http://127.0.0.1:$PORT, log in $STATE/server.log"
    exit 0
  fi
  kill -0 "$(cat "$STATE/server.pid")" 2>/dev/null || { tail -20 "$STATE/server.log" >&2; exit 1; }
  sleep 0.5
done
echo "The server did not answer; see $STATE/server.log" >&2
exit 1
