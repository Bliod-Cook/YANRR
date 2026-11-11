import type { UserSchema } from "@follow/database/schemas/types"
import { UserService } from "@follow/database/services/user"
import type { AuthUser } from "@follow-app/client-sdk"
import { FollowAPIError } from "@follow-app/client-sdk"

import { api, authClient, queryClient } from "../../context"
import type { Hydratable, Resetable } from "../../lib/base"
import { createImmerSetter, createTransaction, createZustandStore } from "../../lib/helper"
import { apiMorph } from "../../morph/api"
import { registerSessionVerifier, startSessionCheck } from "../../sync/account"
import { whoamiQueryKey } from "./constants"
import type { UserProfileEditable } from "./types"

export type UserModel = UserSchema

export type MeModel = Omit<
  AuthUser,
  | "role"
  | "roleEndAt"
  | "stripeCustomerId"
  | "appleAppAccountToken"
  | "emailVerified"
  | "twoFactorEnabled"
  | "lastLoginMethod"
  | "handle"
  | "bio"
  | "website"
  | "socialLinks"
>
export type UserStore = {
  whoami: MeModel | null
}

const defaultState: UserStore = {
  whoami: null,
}

export const useUserStore = createZustandStore<UserStore>("user")(() => defaultState)

const get = useUserStore.getState
const set = useUserStore.setState
const immerSet = createImmerSetter(useUserStore)

/** The fields a profile save sends and keeps, with the name trimmed */
const toProfileChanges = ({ name, ...rest }: Partial<UserProfileEditable>) =>
  name === undefined ? rest : { ...rest, name: name.trim() }

class UserSyncService {
  async whoami() {
    // The answer also tells the transaction queue whose credentials it would send changes with.
    const sessionCheck = startSessionCheck()
    try {
      const res = await this.fetchSession()
      sessionCheck.confirm(res?.user?.id ?? null)
      return res
    } finally {
      sessionCheck.end()
    }
  }

  private async fetchSession() {
    const res = await api()
      .auth.getSession()
      .catch((err) => {
        // Only a 401 tells that the session is gone. Connection failures, timeouts and
        // server errors must not sign the user out locally.
        const isUnauthenticated = err instanceof FollowAPIError && err.status === 401
        if (!isUnauthenticated) {
          throw err
        }
        return null
      })

    if (!res) {
      immerSet((state) => {
        state.whoami = null
      })
      return null
    }

    if (!res.user) return res
    const user = apiMorph.toWhoami(res.user)
    immerSet((state) => {
      state.whoami = user
    })
    userActions.upsertMany([user as unknown as UserModel])

    return res
  }

  async updateProfile(data: Partial<UserProfileEditable>) {
    const me = get().whoami
    if (!me) return
    const changes = toProfileChanges(data)
    const tx = createTransaction(me)

    tx.store(() => {
      immerSet((state) => {
        if (!state.whoami) return
        state.whoami = { ...state.whoami, ...changes } as MeModel
      })
    })

    tx.request(async () => {
      const res = await authClient().updateUser(changes)
      // The auth client resolves with the error instead of throwing; throw so the change rolls back
      if (res.error) {
        throw new Error(res.error.message || res.error.statusText)
      }
    })
    tx.persist(async () => {
      const { whoami } = get()
      if (!whoami) return
      const nextUser = {
        ...whoami,
        ...changes,
      }
      await userActions.upsertMany([nextUser as unknown as UserModel])
    })
    tx.rollback(() => {
      immerSet((state) => {
        if (!state.whoami) return
        state.whoami = me
      })
    })
    await tx.run()
  }
}

class UserActions implements Hydratable, Resetable {
  async hydrate() {
    const users = await UserService.getUserAll()
    userActions.upsertManyInSession(users)
  }

  async reset() {
    const tx = createTransaction()
    tx.store(() => {
      set(defaultState)
    })
    tx.persist(() => UserService.reset())
    await tx.run()
  }

  upsertManyInSession(users: UserModel[]) {
    immerSet((state) => {
      for (const user of users) {
        if (user.isMe) {
          state.whoami = { ...user } as MeModel
        }
      }
    })
  }

  updateWhoami(data: Partial<MeModel>) {
    immerSet((state) => {
      if (!state.whoami) return
      state.whoami = { ...state.whoami, ...data }
    })
  }

  async upsertMany(users: UserModel[]) {
    const tx = createTransaction()
    tx.store(() => this.upsertManyInSession(users))
    const { whoami } = useUserStore.getState()
    tx.persist(() =>
      UserService.upsertMany(
        users.map((user) => ({
          ...user,
          isMe: user.isMe || whoami?.id === user.id,
        })),
      ),
    )
    await tx.run()
  }

  async removeCurrentUser() {
    const tx = createTransaction()
    tx.store(() => {
      immerSet((state) => {
        state.whoami = null
      })
    })
    tx.persist(() => UserService.removeCurrentUser())
    await tx.run()
  }
}

export const userSyncService = new UserSyncService()
export const userActions = new UserActions()

// The transaction queue asks for the session when it does not know whose credentials it would
// send changes with. Through the query cache it shares the request the launch makes anyway.
registerSessionVerifier(() =>
  queryClient().fetchQuery({
    queryKey: whoamiQueryKey,
    queryFn: () => userSyncService.whoami(),
    staleTime: 0,
  }),
)
