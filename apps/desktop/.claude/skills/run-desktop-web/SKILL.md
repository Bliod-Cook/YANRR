---
name: run-desktop-web
description: Start the web build of the desktop renderer (pnpm dev:web) against a local YANRR server and drive it in headless Chromium - sign in, navigate, click, flip settings, take screenshots. Use when asked to run, open or screenshot the web or desktop UI, or to check a client or server change in the real UI.
---

The desktop renderer served as a web app by Vite on http://localhost:2233, forwarding `/api` to a local server, driven
by `.claude/skills/run-desktop-web/driver.mjs`: Playwright, one command per line on stdin. All paths below are relative
to `apps/desktop/`. Verified on Windows 11 with Git Bash.

## Prerequisites

- Client dependencies, installed at the repo root with `corepack pnpm install`.
- A server on http://127.0.0.1:3100, started with the server's run skill (see `server/.claude/skills/run-server`);
  export its `YANRR_AI__*` variables first for the AI parts of the example below:

```bash
(cd ../../server && .claude/skills/run-server/start.sh)
```

- Playwright in a temporary prefix, as the repo does not depend on it. `PLAYWRIGHT_SKIP_BROWSER_GC=1` stops the install
  from deleting other tools' browsers in the shared cache:

```bash
P="${TMPDIR:-${TEMP:-/tmp}}/yanrr-playwright"
npm install --prefix "$P" --no-audit --no-fund playwright@1.51.1
PLAYWRIGHT_SKIP_BROWSER_GC=1 npx --prefix "$P" playwright install chromium
```

## Run (agent path)

```bash
.claude/skills/run-desktop-web/web.sh start
node .claude/skills/run-desktop-web/driver.mjs <<'EOF'
signup run@example.com correct-horse-battery
signin run@example.com correct-horse-battery
api POST /subscriptions {"url":"https://blog.rust-lang.org/feed.xml","view":0}
nav /
click How to Fund Rust Contributors
wait-call /api/ai/summary
sleep 1000
shot summary
nav /settings/general
select settings-action-language-select 简体中文
toggle AI Translation
nav /
click How to Fund Rust Contributors
wait-text 简而言之
shot translation
calls
errors
EOF
.claude/skills/run-desktop-web/web.sh stop
```

`click` takes the exact title of an entry in the list; pick one the feed currently has. Each command prints one line,
`<command> -> <result>` or `-> ERROR <message>`, and a failing command does not stop the rest. Screenshots land in
`${TMPDIR:-$TEMP}/yanrr-web/shots/<name>.png`, the Vite log in `${TMPDIR:-$TEMP}/yanrr-web/vite.log`.

| command | what it does |
|---|---|
| `signup <email> <password>` / `signin <email> <password>` | Creates an account / signs the browser in through the API |
| `api <METHOD> <path> [json]` | Calls `/api<path>` with the browser's session, prints status and body start |
| `nav <path>` | Opens a page of the app |
| `click <text>` | Clicks the first element with exactly that text |
| `wait-text <text>` | Waits up to 120 s for the text, entry content included |
| `wait-call <path>` | Waits up to 120 s for a response from `/api/...`, unless one came already |
| `toggle <label>` | Flips the switch of the settings row with that label |
| `select <test-id> <option>` | Picks an option of a select by its `data-testid` |
| `shot [name]` | Screenshot of the page |
| `calls` / `errors` | `/api` responses / console errors since the last call |
| `sleep <ms>`, `eval <js>`, `quit` | Waits, evaluates an expression in the page, ends early |

## Run (human path)

`VITE_DEV_PROXY_TARGET=http://127.0.0.1:3100 corepack pnpm run dev:web`, then open http://localhost:2233; Ctrl-C stops it.

## Gotchas

- **`VITE_DEV_PROXY_TARGET` must equal the server's `public_url` exactly.** The proxy rewrites `Origin` to the target,
  and the server trusts only its `public_url`; `localhost` against `127.0.0.1` fails sign-in. `web.sh` defaults to
  `http://127.0.0.1:3100`, which is what the server skill uses.
- **The UI language follows the browser locale.** The driver pins en-US so labels are English. The AI output language
  defaults to the UI language, so an English UI with an English feed has nothing to translate: pick another language
  with `select settings-action-language-select 简体中文` first.
- **Settings written to the server do not reach a fresh browser.** The client keeps its own settings on a new device
  and pushes them up, so a `PATCH /api/settings/*` made beforehand is overwritten. Change settings in the UI with
  `toggle` and `select`.
- **The summary card shows its title while the summary loads.** Wait for the answer with `wait-call /api/ai/summary`,
  not for the card's text; an uncached summary takes a few seconds.
- **Entry content renders in a shadow DOM.** `eval document.body.innerText` misses it; `wait-text` finds it.
- **Proxies in the environment catch localhost.** The driver launches Chromium with `--no-proxy-server`.
- **pnpm runs Vite as a child process.** `web.sh stop` kills whatever listens on 2233 with its children; killing pnpm
  alone leaves Vite running.

## Troubleshooting

- **`wait-text` times out after turning AI Translation on, while `calls` shows `POST /api/ai/translation/batch 200`**:
  the output language is the feed's language. Select another one.
- **`signin` answers `403 {"code":"INVALID_ORIGIN"...}`**: Vite forwards to a different host than the server's
  `public_url`. Restart with a matching `VITE_DEV_PROXY_TARGET`.
