import { describe, expect, it } from "vitest"

import { dismissToast } from "./state"
import type { ToastProps } from "./types"

const toast = (id: number): ToastProps => ({
  id,
  type: "info",
  message: `toast ${id}`,
  duration: 0,
})

describe("dismissToast", () => {
  it("hides the toast it belongs to", () => {
    expect(dismissToast(toast(1), 1)).toBeNull()
  })

  it("keeps the toast that replaced it", () => {
    const replacement = toast(2)

    expect(dismissToast(replacement, 1)).toBe(replacement)
  })
})
