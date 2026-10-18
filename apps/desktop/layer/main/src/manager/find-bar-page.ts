// The find bar's page, loaded into a view of its own above the window's page. It talks to the
// main process through the app's preload script (`window.electron`).

export const FindBarChannel = {
  /** Page to main: find `{ text, direction }` */
  find: "find-bar:find",
  /** Page to main: the text was emptied */
  clear: "find-bar:clear",
  /** Page to main: Escape or the close button */
  close: "find-bar:close",
  /** Main to page: shown, `{ labels, accent }` */
  open: "find-bar:open",
  /** Main to page: `{ activeMatchOrdinal, matches }` */
  result: "find-bar:result",
} as const

/** Room around the bar for its shadow, in the page and in the view's bounds */
export const FIND_BAR_SHADOW_MARGIN = 16
export const FIND_BAR_WIDTH = 256
export const FIND_BAR_HEIGHT = 36

// MingCute back-2, forward-2 and close (cute, regular)
const icons = {
  previous:
    "***REMOVED***",
  next: "***REMOVED***",
  close:
    "***REMOVED***",
}

const icon = (path: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="currentColor" fill-rule="evenodd"/></svg>`

// Runs in the page. Kept as a function so that it is type-checked, then inlined as source.
function findBarScript(channel: typeof FindBarChannel) {
  type IpcListener = (event: unknown, payload: never) => void
  const { ipcRenderer } = (
    window as unknown as {
      electron: {
        ipcRenderer: {
          send: (channel: string, payload?: unknown) => void
          on: (channel: string, listener: IpcListener) => void
        }
      }
    }
  ).electron

  const bar = document.querySelector("form")!
  const input = document.querySelector("input")!
  const count = document.querySelector("output")!
  const previous = document.querySelector<HTMLButtonElement>("#previous")!
  const next = document.querySelector<HTMLButtonElement>("#next")!
  const close = document.querySelector<HTMLButtonElement>("#close")!

  let composing = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const find = (direction: "forward" | "backward") => {
    clearTimeout(timer)
    if (composing) return
    if (!input.value) {
      count.textContent = ""
      ipcRenderer.send(channel.clear)
      return
    }
    ipcRenderer.send(channel.find, { text: input.value, direction })
  }
  const findSoon = () => {
    clearTimeout(timer)
    timer = setTimeout(() => find("forward"), 200)
  }

  input.addEventListener("input", () => {
    if (!composing) findSoon()
  })
  input.addEventListener("compositionstart", () => {
    composing = true
  })
  input.addEventListener("compositionend", () => {
    composing = false
    findSoon()
  })
  input.addEventListener("keydown", (event) => {
    if (event.isComposing || composing) return
    if (event.key === "Enter") {
      event.preventDefault()
      find(event.shiftKey ? "backward" : "forward")
    } else if (event.key === "Escape") {
      event.preventDefault()
      ipcRenderer.send(channel.close)
    }
  })
  bar.addEventListener("submit", (event) => event.preventDefault())
  for (const button of [previous, next, close]) {
    // Keeps the focus, and with it typing and Enter, in the field
    button.addEventListener("mousedown", (event) => event.preventDefault())
  }
  previous.addEventListener("click", () => find("backward"))
  next.addEventListener("click", () => find("forward"))
  close.addEventListener("click", () => ipcRenderer.send(channel.close))

  ipcRenderer.on(
    channel.open,
    (
      _event,
      {
        labels,
        accent,
      }: {
        labels: { find: string; previous: string; next: string; close: string }
        accent: string | null
      },
    ) => {
      input.setAttribute("aria-label", labels.find)
      for (const [button, label] of [
        [previous, labels.previous],
        [next, labels.next],
        [close, labels.close],
      ] as const) {
        button.title = label
        button.setAttribute("aria-label", label)
      }
      if (accent) document.documentElement.style.setProperty("--accent", accent)

      bar.classList.remove("appear")
      void bar.offsetWidth
      bar.classList.add("appear")
      // Like browser find bars, it starts with the previous search, selected
      input.focus()
      input.select()
    },
  )
  ipcRenderer.on(
    channel.result,
    (_event, { activeMatchOrdinal, matches }: { activeMatchOrdinal: number; matches: number }) => {
      count.textContent =
        input.value && matches > 0 && activeMatchOrdinal > 0
          ? `${activeMatchOrdinal}/${matches}`
          : ""
    },
  )
}

export const findBarPage = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
:root {
  color-scheme: light dark;
  --accent: hsl(21.6 100% 50%);
  --background: rgb(250 250 250 / 0.97);
  --border: rgb(0 0 0 / 0.1);
  --text: rgb(0 0 0 / 0.85);
  --secondary: rgb(0 0 0 / 0.5);
  --hover: rgb(0 0 0 / 0.06);
}
@media (prefers-color-scheme: dark) {
  :root {
    --background: rgb(38 38 38 / 0.97);
    --border: rgb(255 255 255 / 0.1);
    --text: rgb(255 255 255 / 0.88);
    --secondary: rgb(255 255 255 / 0.55);
    --hover: rgb(255 255 255 / 0.08);
  }
}
html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
body { box-sizing: border-box; padding: ${FIND_BAR_SHADOW_MARGIN}px; font: 15px system-ui, sans-serif; color: var(--text); }
form {
  box-sizing: border-box; display: flex; align-items: center; gap: 4px;
  width: ${FIND_BAR_WIDTH}px; height: ${FIND_BAR_HEIGHT}px; margin: 0; padding: 0 6px 0 12px;
  border: 1px solid var(--border); border-radius: 16px; background: var(--background);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 6px 16px rgb(0 0 0 / 0.12);
}
form:focus-within { border-color: var(--accent); }
form.appear { animation: appear 160ms ease-out; }
@keyframes appear { from { opacity: 0; transform: translateY(-6px); } }
@media (prefers-reduced-motion: reduce) { form.appear { animation: none; } }
input {
  flex: 1; min-width: 0; height: 100%; margin: 0 4px 0 0; padding: 0; border: 0; outline: 0;
  background: transparent; color: inherit; font: inherit; caret-color: var(--accent);
}
output { color: var(--secondary); font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
output:not(:empty) { margin-right: 4px; }
button {
  display: grid; place-items: center; flex: none; width: 24px; height: 24px; padding: 0;
  border: 0; border-radius: 8px; background: transparent; color: inherit; opacity: 0.8;
}
button:hover { opacity: 1; background: var(--hover); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
svg { width: 16px; height: 16px; }
</style>
</head>
<body>
<form autocomplete="off">
<input type="text" spellcheck="false">
<output aria-live="polite"></output>
<button type="button" id="previous">${icon(icons.previous)}</button>
<button type="button" id="next">${icon(icons.next)}</button>
<button type="button" id="close">${icon(icons.close)}</button>
</form>
<script>(${findBarScript.toString()})(${JSON.stringify(FindBarChannel)})</script>
</body>
</html>`
