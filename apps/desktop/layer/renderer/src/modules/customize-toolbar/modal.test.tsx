import type { DndContext } from "@dnd-kit/core"
import { Provider } from "jotai"
import type { ComponentProps } from "react"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeAll, expect, test, vi } from "vitest"

import { getUISettings, initializeDefaultUISettings } from "~/atoms/settings/ui"
import { jotaiStore } from "~/lib/jotai"
import { COMMAND_ID } from "~/modules/command/commands/id"
import { registerCommand } from "~/modules/command/registry/registry"

import { CustomizeToolbar } from "./modal"

type DragHandlers = Pick<
  ComponentProps<typeof DndContext>,
  "onDragOver" | "onDragEnd" | "onDragCancel"
>
let dragHandlers: DragHandlers

// Drive the drag lifecycle without depending on happy-dom's missing layout measurements.
vi.mock("@dnd-kit/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dnd-kit/core")>()),
  DndContext: ({ children, ...handlers }: ComponentProps<typeof DndContext>) => {
    dragHandlers = handlers
    return children
  },
}))
vi.mock("~/lib/auth", () => ({}))

beforeAll(() => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

test("saves a gallery move between toolbars only on drop, so cancelling keeps the order", async () => {
  initializeDefaultUISettings()
  const initialOrder = getUISettings().toolbarOrder
  const unregister = registerCommand({
    id: COMMAND_ID.entry.imageGallery,
    label: "Image Gallery",
    run: () => {},
  })
  const root = createRoot(document.createElement("div"))
  const drag = {
    active: { id: COMMAND_ID.entry.imageGallery },
    over: { id: COMMAND_ID.entry.star },
  }
  try {
    await act(async () =>
      root.render(
        <Provider store={jotaiStore}>
          <CustomizeToolbar />
        </Provider>,
      ),
    )
    await act(async () => {
      dragHandlers.onDragOver?.(drag as Parameters<NonNullable<DragHandlers["onDragOver"]>>[0])
      dragHandlers.onDragCancel?.(drag as Parameters<NonNullable<DragHandlers["onDragCancel"]>>[0])
    })
    expect(getUISettings().toolbarOrder).toEqual(initialOrder)

    await act(async () => {
      dragHandlers.onDragEnd?.(drag as Parameters<NonNullable<DragHandlers["onDragEnd"]>>[0])
    })
    const { main, more } = getUISettings().toolbarOrder
    expect(main).toContain(COMMAND_ID.entry.imageGallery)
    expect(main.indexOf(COMMAND_ID.entry.imageGallery)).toBe(
      main.indexOf(COMMAND_ID.entry.star) - 1,
    )
    expect(more).not.toContain(COMMAND_ID.entry.imageGallery)
  } finally {
    await act(async () => root.unmount())
    unregister()
    initializeDefaultUISettings()
  }
})
