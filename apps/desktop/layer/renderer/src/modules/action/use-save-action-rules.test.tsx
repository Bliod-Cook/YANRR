import { actionSyncService, useActionStore } from "@follow/store/action/store"
import { FollowAPIError } from "@follow-app/client-sdk"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { toast } from "sonner"
import type { MockInstance } from "vitest"
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

import { useSaveActionRules } from "./use-save-action-rules"

const { present, toastFetchError } = vi.hoisted(() => ({
  present: vi.fn(),
  toastFetchError: vi.fn(),
}))

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>()
  return {
    ...actual,
    ["useTranslation"]: () => ({
      t: (key: string, options?: { name?: string }) =>
        options?.name ? `${key}:${options.name}` : key,
    }),
  }
})

vi.mock("~/components/ui/modal/stacked/hooks", () => ({
  ["useModalStack"]: () => ({ present }),
}))

vi.mock("~/lib/error-parser", () => ({ toastFetchError }))

type PresentOptions = {
  title: ReactNode
  content: (props: { dismiss: () => void }) => ReactNode
}

const conflictError = () =>
  new FollowAPIError("The action rules were changed elsewhere", 409, "12001")

describe("useSaveActionRules", () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  let save!: ReturnType<typeof useSaveActionRules>["save"]
  let toastError!: MockInstance<typeof toast.error>
  const onSuccess = vi.fn()

  const Harness = () => {
    save = useSaveActionRules({ onSuccess }).save
    return null
  }

  const render = async (node: ReactNode) => {
    await act(async () => {
      root!.render(node)
    })
  }

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(async () => {
    vi.restoreAllMocks()
    toastError = vi.spyOn(toast, "error")
    present.mockReset()
    toastFetchError.mockReset()
    onSuccess.mockReset()
    useActionStore.setState({ rules: [], isDirty: false })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await render(
      <QueryClientProvider client={new QueryClient()}>
        <Harness />
      </QueryClientProvider>,
    )
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    container?.remove()
    root = null
    container = null
  })

  const saveAndSettle = async () => {
    await act(async () => {
      save()
      await vi.waitFor(() => {
        expect(
          present.mock.calls.length +
            toastFetchError.mock.calls.length +
            toastError.mock.calls.length +
            onSuccess.mock.calls.length,
        ).toBeGreaterThan(0)
      })
    })
  }

  const presentedContent = async () => {
    const options = present.mock.calls[0]![0] as PresentOptions
    const dismiss = vi.fn()
    const dialog = document.createElement("div")
    document.body.append(dialog)
    const dialogRoot = createRoot(dialog)
    await act(async () => {
      dialogRoot.render(<>{options.content({ dismiss })}</>)
    })
    const button = (label: string) =>
      [...dialog.querySelectorAll("button")].find((element) =>
        element.textContent?.includes(label),
      )!
    return { options, dismiss, button, dialogRoot }
  }

  test("asks what to do instead of overwriting rules changed elsewhere", async () => {
    const saveRules = vi.spyOn(actionSyncService, "saveRules")
    saveRules.mockRejectedValueOnce(conflictError()).mockResolvedValueOnce(null)

    await saveAndSettle()

    expect(toastFetchError).not.toHaveBeenCalled()
    expect(present).toHaveBeenCalledTimes(1)
    const { options, dismiss, button, dialogRoot } = await presentedContent()
    expect(options.title).toBe("actions.conflict.title")

    // Saving over them is a deliberate second save
    await act(async () => {
      button("actions.conflict.overwrite").click()
      await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    })
    expect(dismiss).toHaveBeenCalled()
    expect(saveRules).toHaveBeenLastCalledWith({ overwrite: true })
    await act(async () => dialogRoot.unmount())
  })

  test("loads the latest rules when the user chooses to", async () => {
    vi.spyOn(actionSyncService, "saveRules").mockRejectedValueOnce(conflictError())
    const fetchRules = vi
      .spyOn(actionSyncService, "fetchRules")
      .mockResolvedValue({ code: 0, data: null })

    await saveAndSettle()
    const { button, dismiss, dialogRoot } = await presentedContent()
    await act(async () => {
      button("actions.conflict.reload").click()
    })

    expect(dismiss).toHaveBeenCalled()
    expect(fetchRules).toHaveBeenCalledWith()
    await act(async () => dialogRoot.unmount())
  })

  test("names a rule with an incomplete condition instead of saving", async () => {
    const saveRules = vi.spyOn(actionSyncService, "saveRules")
    useActionStore.setState({
      rules: [
        { name: "Unfinished", condition: [[{ field: "entry_title" }]], result: {}, index: 0 },
      ],
      isDirty: true,
    })

    await saveAndSettle()

    expect(saveRules).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith("actions.save_incomplete_condition:Unfinished")
  })

  test("names the rule whose regex the server refused", async () => {
    useActionStore.setState({
      rules: [
        { name: "Fine", condition: [], result: {}, index: 0 },
        {
          name: "Broken",
          condition: [[{ field: "entry_title", operator: "regex", value: "a(" }]],
          result: {},
          index: 1,
        },
      ],
      isDirty: true,
    })
    vi.spyOn(actionSyncService, "saveRules").mockRejectedValueOnce(
      new FollowAPIError("`rules.1.condition.0.0.value`: Invalid regex: unclosed group", 422, "3"),
    )

    await saveAndSettle()

    expect(toastFetchError).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith("actions.save_invalid_regex:Broken", {
      description: "Invalid regex: unclosed group",
    })
  })

  test("shows other errors as before", async () => {
    const error = new FollowAPIError("Action limit exceeded", 400, "12000")
    vi.spyOn(actionSyncService, "saveRules").mockRejectedValueOnce(error)

    await saveAndSettle()

    expect(present).not.toHaveBeenCalled()
    expect(toastFetchError).toHaveBeenCalledWith(error)
  })
})
