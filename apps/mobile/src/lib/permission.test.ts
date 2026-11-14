import { EventBus } from "@follow/utils/event-bus"
import { expect, it, vi } from "vitest"

import { requestNotificationPermission } from "./permission"

const mocks = vi.hoisted(() => {
  // The event bus of the app dispatches on its global event target
  vi.stubGlobal("window", new EventTarget())
  return { status: "undetermined" }
})

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }))
vi.mock("i18next", () => ({ t: (key: string) => key }))
vi.mock("expo-notifications", () => ({
  getPermissionsAsync: async () => ({ status: mocks.status }),
  // The user answers the system's prompt
  requestPermissionsAsync: async () => {
    mocks.status = "granted"
    return { status: mocks.status }
  },
}))
vi.mock("../atoms/settings/ui", () => ({ getUISettings: () => ({}) }))
vi.mock("./toast", () => ({ toast: { error: vi.fn() } }))

it("tells push registration once the user grants the permission", async () => {
  const granted = vi.fn()
  const unsubscribe = EventBus.subscribe("NOTIFICATION_PERMISSION_GRANTED", granted)

  await expect(requestNotificationPermission()).resolves.toBe(true)

  expect(granted).toHaveBeenCalledOnce()
  unsubscribe()
})
