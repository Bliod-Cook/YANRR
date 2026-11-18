import type { DndContextProps, DragOverEvent } from "@dnd-kit/core"
import { setNavigate, setRoute } from "@follow/components/atoms/route.js"
import { Provider } from "jotai"
import * as React from "react"
import { act, use } from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"

import { getUISettings, setUISetting } from "~/atoms/settings/ui"
import {
  CurrentModalContext,
  PresentModalContextInternal,
} from "~/components/ui/modal/stacked/context"
import { jotaiStore } from "~/lib/jotai"

import { useShowTimelineTabsSettingsModal } from "./TimelineTabsSettingsModal"

let drag: DndContextProps
vi.mock("@dnd-kit/core", async (original) => ({
  ...(await original<typeof import("@dnd-kit/core")>()),
  DndContext: (props: DndContextProps) => {
    drag = props
    return null
  },
}))

test("only saves a tab move and leaves a hidden timeline when the tab is dropped", async () => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  setUISetting("timelineTabs", { visible: ["articles", "videos"], hidden: [] })
  setRoute({
    params: { timelineId: "articles", feedId: "all" },
    searchParams: new URLSearchParams(),
    location: {
      pathname: "/timeline/articles/all/pending",
      search: "",
      hash: "",
      state: null,
      key: "",
    },
  })
  const navigate = vi.fn()
  setNavigate({ fn: navigate })

  function OpenSettings() {
    return <button onClick={useShowTimelineTabsSettingsModal()}>Open settings</button>
  }
  function ModalHost() {
    const [modal, setModal] = React.useState<React.ReactNode>()
    const actions = use(CurrentModalContext)
    return (
      <PresentModalContextInternal
        value={({ content: Content }) => {
          setModal(<Content {...actions} />)
          return () => setModal(null)
        }}
      >
        {modal ?? <OpenSettings />}
      </PresentModalContextInternal>
    )
  }
  const host = document.createElement("div")
  const root = createRoot(host)
  const event: DragOverEvent = {
    active: {
      id: "articles",
      data: { current: {} },
      rect: { current: { initial: null, translated: null } },
    },
    over: {
      id: "hidden",
      data: { current: { container: "hidden" } },
      disabled: false,
      rect: host.getBoundingClientRect(),
    },
    activatorEvent: new Event("pointerdown"),
    collisions: [],
    delta: { x: 0, y: 50 },
  }
  try {
    await act(async () =>
      root.render(
        <Provider store={jotaiStore}>
          <ModalHost />
        </Provider>,
      ),
    )
    await act(async () => host.querySelector("button")!.click())
    await act(async () => drag.onDragOver?.(event))
    await act(async () => drag.onDragCancel?.(event))
    expect(getUISettings().timelineTabs?.visible).toContain("articles")
    expect(navigate).not.toHaveBeenCalled()
    await act(async () => drag.onDragEnd?.(event))
    expect(getUISettings().timelineTabs?.hidden).toContain("articles")
    expect(navigate).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
  }
})
