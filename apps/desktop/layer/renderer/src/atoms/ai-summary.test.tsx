import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeAll, describe, expect, test } from "vitest"

import { useShowAISummary } from "./ai-summary"
import { setServerConfigs } from "./server-configs"
import { setGeneralSetting } from "./settings/general"

const Probe = () => <output>{String(useShowAISummary(true))}</output>

describe("useShowAISummary", () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  test("shows no summary card while the server has AI off, whatever the settings say", async () => {
    setServerConfigs({} as never)
    setGeneralSetting("summary", true)
    const host = document.createElement("div")
    const root = createRoot(host)

    await act(async () => root.render(<Probe />))

    expect(host.textContent).toBe("false")
    await act(async () => root.unmount())
  })
})
