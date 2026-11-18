import { subscriptionSyncService } from "@follow/store/subscription/store"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"

import { CategoryUnsubscribeDialogContent } from "./CategoryUnsubscribeDialogContent"

test("unsubscribes only the feeds shown in the selected folder", async () => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  const unsubscribe = vi.spyOn(subscriptionSyncService, "unsubscribe").mockResolvedValue([])
  const host = document.createElement("div")
  const root = createRoot(host)
  const client = new QueryClient()
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <CategoryUnsubscribeDialogContent category="folder-Tech" feedIds={["visible-feed"]} />
        </QueryClientProvider>,
      ),
    )
    await act(async () => host.querySelectorAll("button")[1]!.click())
    expect(unsubscribe).toHaveBeenCalledWith(["visible-feed"])
  } finally {
    await act(async () => root.unmount())
    client.clear()
    unsubscribe.mockRestore()
  }
})
