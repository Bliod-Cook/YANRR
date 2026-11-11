import { StableRouterProvider } from "@follow/components/providers/stable-router-provider.js"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { createMemoryRouter, RouterProvider } from "react-router"
import { beforeAll, describe, expect, test } from "vitest"

import { getPreviewBackPath, navigateEntry } from "./useNavigateEntry"

const discoverPath = "/discover?keyword=rss"

describe("the way back from a feed preview", () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  test("belongs to the preview, not to the pages opened after it", async () => {
    const element = <StableRouterProvider />
    const router = createMemoryRouter(
      [
        { path: "/timeline/:timelineId/:feedId/:entryId", element },
        { path: "*", element },
      ],
      { initialEntries: [discoverPath] },
    )
    const root = createRoot(document.createElement("div"))
    await act(async () => {
      root.render(<RouterProvider router={router} />)
    })

    await act(async () => {
      await navigateEntry({ feedId: "previewed", backPath: discoverPath })
    })
    expect(getPreviewBackPath()).toBe(discoverPath)

    // An entry opened in the preview still shows it
    await act(async () => {
      await navigateEntry({ entryId: "entry" })
    })
    expect(getPreviewBackPath()).toBe(discoverPath)

    await act(async () => {
      await navigateEntry({ feedId: "subscribed" })
    })
    expect(getPreviewBackPath()).toBeUndefined()

    await act(async () => {
      await router.navigate(-1)
    })
    expect(getPreviewBackPath()).toBe(discoverPath)

    await act(async () => {
      root.unmount()
    })
  })
})
