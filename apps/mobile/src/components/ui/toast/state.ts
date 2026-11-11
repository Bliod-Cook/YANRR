import type { ToastProps } from "./types"

/** The toast shown once the one with `id` goes: none, unless another toast replaced it */
export const dismissToast = (shown: ToastProps | null, id: number) =>
  shown?.id === id ? null : shown
