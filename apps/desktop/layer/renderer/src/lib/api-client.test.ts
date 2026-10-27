import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { fetchWithElectronAuth, followClient } from "./api-client"

const ipc = vi.hoisted(() => {
  vi.stubEnv("VITE_API_URL", "https://rss.example.com/api")
  return { fetchWithAuth: vi.fn(), cancelFetch: vi.fn() }
})

vi.mock("./client", () => ({ ipcServices: { auth: ipc } }))

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("followClient responses", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("parses a JSON body once", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ code: 0, data: {} }))
    const parse = vi.spyOn(Response.prototype, "json")

    await followClient.api.status.getConfigs()

    expect(parse).toHaveBeenCalledTimes(1)
  })

  it("still reads errors and empty answers", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ code: 2001, message: "Feed not found" }, 404))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(followClient.api.feeds.get({ id: "1" })).rejects.toMatchObject({
      status: 404,
      message: "Feed not found",
    })
    await expect(followClient.api.status.getConfigs()).resolves.toBeDefined()
  })
})

describe("fetchWithElectronAuth", () => {
  const url = "https://rss.example.com/api/status/configs"

  beforeEach(() => {
    ;(window as { electron?: unknown }).electron = {}
  })

  afterEach(() => {
    delete (window as { electron?: unknown }).electron
    ipc.fetchWithAuth.mockReset()
    ipc.cancelFetch.mockReset()
  })

  it("refuses a request aborted before it was sent", async () => {
    const reason = new Error("gone")

    await expect(
      fetchWithElectronAuth(new Request(url, { signal: AbortSignal.abort(reason) })),
    ).rejects.toBe(reason)
    expect(ipc.fetchWithAuth).not.toHaveBeenCalled()
  })

  it("rejects at once on abort and has the main process stop the request", async () => {
    ipc.fetchWithAuth.mockReturnValue(new Promise(() => {}))
    const controller = new AbortController()
    const reason = new Error("timed out")

    const sent = fetchWithElectronAuth(new Request(url, { signal: controller.signal }))
    await vi.waitFor(() => expect(ipc.fetchWithAuth).toHaveBeenCalled())
    controller.abort(reason)

    await expect(sent).rejects.toBe(reason)
    const { requestId } = ipc.fetchWithAuth.mock.calls[0]![0]
    expect(ipc.cancelFetch).toHaveBeenCalledWith(requestId)
  })

  it("lets go of the signal once answered", async () => {
    ipc.fetchWithAuth.mockResolvedValue({ body: "{}", headers: [], status: 200, statusText: "OK" })
    const controller = new AbortController()

    const response = await fetchWithElectronAuth(new Request(url, { signal: controller.signal }))
    controller.abort()

    expect(await response.text()).toBe("{}")
    expect(ipc.cancelFetch).not.toHaveBeenCalled()
  })
})
