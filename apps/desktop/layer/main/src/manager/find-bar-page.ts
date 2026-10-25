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

/**
 * Room around the bar for its shadow, in the page and in the view's bounds. The view takes the
 * clicks in it, so the top stays narrow: the shadow falls below the bar, and the buttons of the
 * page's header reach down to just above it.
 */
export const FIND_BAR_SHADOW_MARGIN = { top: 6, side: 16, bottom: 16 } as const
export const FIND_BAR_WIDTH = 256
export const FIND_BAR_HEIGHT = 36

// MingCute's open-source back-2-line, forward-2-line and close-line
const icons = {
  previous:
    '<path fill="currentColor" d="M20 15.5a1 1 0 1 0 2 0zM3.418 12.706a1 1 0 1 0 1.911.588L4.373 13zm7.035.237a1 1 0 1 0-.348-1.97l.174.985zM4.37 13l-.985.174a1 1 0 0 0 1.159.81zm-.057-6.082a1 1 0 1 0-1.97.347l.985-.174zM12.5 7v1a7.5 7.5 0 0 1 7.5 7.5h2A9.5 9.5 0 0 0 12.5 6zm-8.127 6l.956.294A7.5 7.5 0 0 1 12.5 8V6a9.5 9.5 0 0 0-9.081 6.706zm5.906-1.042l-.174-.985l-5.909 1.042l.174.985l.174.985l5.909-1.042zM4.37 13l.985-.174l-1.042-5.908l-.985.173l-.985.174l1.042 5.909z"/>',
  next: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15.5a8.5 8.5 0 0 1 16.456-3m-5.735-.542L19.63 13l1.042-5.909"/>',
  close:
    '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="m5.636 5.637l12.728 12.728m-12.728 0L18.364 5.637"/>',
}

const icon = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`

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
  const requestClose = () => {
    // A search still waiting for the typing to stop would run in the page after the bar closed
    clearTimeout(timer)
    ipcRenderer.send(channel.close)
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
      requestClose()
    }
  })
  bar.addEventListener("submit", (event) => event.preventDefault())
  for (const button of [previous, next, close]) {
    // Keeps the focus, and with it typing and Enter, in the field
    button.addEventListener("mousedown", (event) => event.preventDefault())
  }
  previous.addEventListener("click", () => find("backward"))
  next.addEventListener("click", () => find("forward"))
  close.addEventListener("click", requestClose)

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
body { box-sizing: border-box; padding: ${FIND_BAR_SHADOW_MARGIN.top}px ${FIND_BAR_SHADOW_MARGIN.side}px ${FIND_BAR_SHADOW_MARGIN.bottom}px; font: 15px system-ui, sans-serif; color: var(--text); }
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
