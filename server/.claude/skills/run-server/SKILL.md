---
name: run-server
description: Start, smoke-test and stop the YANRR Rust server (API, optionally with AI) on a throwaway PostgreSQL, and call its routes with curl. Use when asked to run or start the server, try an API route, check AI summaries or translations against a real model, or run the server tests.
---

The Axum server, started by `start.sh` on a throwaway PostgreSQL with configuration from the environment only, then
driven with `curl`; `smoke.sh` is the worked example. All paths below are relative to `server/`. Verified on Windows 11
with Git Bash; the scripts are plain bash.

## Prerequisites

- Rust stable and curl.
- PostgreSQL binaries: `pg_ctl` on `PATH`, or the copy the integration tests download into
  `~/.theseus/postgresql/<version>/bin`. One test run fetches it:

```bash
cargo test --test api
```

## Run (agent path)

```bash
.claude/skills/run-server/start.sh         # builds; PostgreSQL on 127.0.0.1:54329, server on http://127.0.0.1:3100
.claude/skills/run-server/smoke.sh         # signs up, follows a feed, reads it back, AI summary and translation
.claude/skills/run-server/stop.sh --clean  # stops both; --clean also deletes the database
```

- `start.sh` reads `PORT` (3100), `PG_PORT` (54329) and `YANRR_RUN_DIR` (`${TMPDIR:-$TEMP}/yanrr-run`, which holds the
  database, the search index, `server.log`, `build.log` and `smoke.sh`'s `cookies.txt`). Without `--clean`, the next
  start keeps the data.
- `smoke.sh [feed-url]` follows `https://blog.rust-lang.org/feed.xml` by default, as `run@example.com` /
  `correct-horse-battery`.
- Any other setting goes in as `YANRR_<SECTION>__<KEY>`, exported before `start.sh`. For AI (any OpenAI-compatible API;
  without it the AI routes answer code 5):

```bash
export YANRR_AI__BASE_URL=https://api.openai.com/v1 YANRR_AI__API_KEY=<key> YANRR_AI__MODEL=<model>
```

Calling a route yourself after `smoke.sh` signed in:

```bash
curl -s --noproxy '*' -b "${TMPDIR:-${TEMP:-/tmp}}/yanrr-run/cookies.txt" -H 'Origin: http://127.0.0.1:3100' \
  http://127.0.0.1:3100/api/subscriptions
```

## Test

```bash
cargo fmt --check && cargo test --locked
```

Each integration test starts its own embedded PostgreSQL, so the suite takes a few minutes.

## Gotchas

- **Proxies in the environment catch localhost.** With `HTTP_PROXY`/`HTTPS_PROXY` set, `curl` to 127.0.0.1 gets a 502
  from the proxy; the scripts pass `--noproxy '*'`. The server itself keeps using the proxy for feeds and the model.
- **The server only trusts its own origin.** better-auth refuses a sign-in whose `Origin` is not `public_url`, so
  `start.sh` makes `public_url` `http://127.0.0.1:$PORT`, and requests send that `Origin`.
- **A developer's `config.toml` is ignored on purpose.** `start.sh` passes a config path that does not exist, so only
  the environment configures the server.
- **`initdb` fails on some system locales** ("could not find suitable text search configuration for locale Chinese
  (Simplified)_China.utf8"); `start.sh` uses `--locale=C`.
- **The Windows linker prints hundreds of LNK4099 warnings** while building; they are harmless, so `start.sh` sends the
  build output to `build.log` and shows only errors.
- **`Yanrr.exe` (capitalized) processes are the installed desktop app**, not this server (`yanrr.exe`).

## Troubleshooting

- **`{"code":"INVALID_ORIGIN","message":"Invalid origin"}` (403) on sign-in**: the request's `Origin` differs from the
  server's `public_url`, e.g. `localhost` against `127.0.0.1`. Send `Origin: http://127.0.0.1:$PORT`.
- **`{"code":5,"message":"AI is not configured"}`**: the server started without `YANRR_AI__*`; export them and restart.
