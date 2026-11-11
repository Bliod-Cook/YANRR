import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { UserService } from "@follow/database/services/user"
import type { AuthClient } from "@follow/shared/auth"
import { createAppAuthClient } from "@follow/shared/auth"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { authClientContext } from "../../context"
import type { MeModel } from "./store"
import { userSyncService, useUserStore } from "./store"

vi.mock("@follow/database/services/user", () => ({
  UserService: {
    getUserAll: vi.fn(async () => []),
    reset: vi.fn(async () => {}),
    upsertMany: vi.fn(async () => {}),
    removeCurrentUser: vi.fn(async () => {}),
  },
}))

const me = { id: "user1", name: "Me", email: "me@example.com" } as MeModel

describe("userSyncService.whoami", () => {
  // A real auth client against a real HTTP server answering like the server's session endpoint
  let answer: { status: number; body: unknown } = { status: 200, body: null }
  const server = createServer((_request, response) => {
    response.writeHead(answer.status, { "content-type": "application/json" })
    response.end(JSON.stringify(answer.body))
  })
  let baseUrl = ""

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => void server.close())

  beforeEach(() => {
    vi.clearAllMocks()
    useUserStore.setState({ whoami: me })
    answer = { status: 200, body: null }
    authClientContext.provide(createAppAuthClient({ apiURL: baseUrl }))
  })

  it.each([
    ["server error", 500],
    ["rate limit", 429],
  ])("keeps the local user when the server answers %s", async (_, status) => {
    answer = { status, body: { message: "Failed" } }

    await expect(userSyncService.whoami()).rejects.toMatchObject({ status })
    expect(useUserStore.getState().whoami).toEqual(me)
  })

  it("keeps the local user when the server cannot be reached", async () => {
    authClientContext.provide(createAppAuthClient({ apiURL: "http://127.0.0.1:1" }))

    await expect(userSyncService.whoami()).rejects.toThrow()
    expect(useUserStore.getState().whoami).toEqual(me)
  })

  it("clears the local user on a 401", async () => {
    answer = { status: 401, body: { message: "Unauthorized" } }

    await expect(userSyncService.whoami()).resolves.toBeNull()
    expect(useUserStore.getState().whoami).toBeNull()
  })

  it("clears the local user when the server returns no session", async () => {
    await expect(userSyncService.whoami()).resolves.toBeNull()
    expect(useUserStore.getState().whoami).toBeNull()
    // The next launch would otherwise start signed in as the user in the database
    expect(UserService.removeCurrentUser).toHaveBeenCalledTimes(1)
  })

  it("stores the user of the session", async () => {
    const createdAt = "2024-01-01T00:00:00.000Z"
    answer = {
      status: 200,
      body: { user: { ...me, name: "Renamed", createdAt, updatedAt: createdAt }, session: {} },
    }

    await expect(userSyncService.whoami()).resolves.toMatchObject({ user: { id: "user1" } })
    expect(useUserStore.getState().whoami).toMatchObject({
      id: "user1",
      name: "Renamed",
      createdAt,
      updatedAt: createdAt,
    })
  })
})

describe("userSyncService.updateProfile", () => {
  const updateUserMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useUserStore.setState({ whoami: me })
    authClientContext.provide({ updateUser: updateUserMock } as unknown as AuthClient)
  })

  it("rolls the change back when the auth server rejects it", async () => {
    updateUserMock.mockResolvedValue({
      data: null,
      error: { message: "Name is too long", status: 400, statusText: "Bad Request" },
    })

    await expect(userSyncService.updateProfile({ name: "taken" })).rejects.toThrow(
      "Name is too long",
    )
    expect(useUserStore.getState().whoami).toEqual(me)
  })

  it("keeps the change, with the name trimmed, when the auth server accepts it", async () => {
    updateUserMock.mockResolvedValue({ data: { status: true }, error: null })

    await userSyncService.updateProfile({ name: "  New Name " })

    expect(updateUserMock).toHaveBeenCalledWith({ name: "New Name" })
    expect(useUserStore.getState().whoami).toEqual({ ...me, name: "New Name" })
  })
})
