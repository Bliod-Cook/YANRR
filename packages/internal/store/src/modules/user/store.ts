import type { UserSchema } from "@follow/database/schemas/types"
import { UserService } from "@follow/database/services/user"
import type { AuthUser } from "@follow-app/client-sdk"
import { FollowAPIError } from "@follow-app/client-sdk"

import { authClient, queryClient } from "../../context"
import type { Hydratable } from "../../lib/base"
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
    // Through the auth client, so one request also lets the Expo plugin keep the refreshed cookie.
    // It resolves with the error instead of throwing; connection failures still throw.
    const { data, error } = await authClient().getSession()
    // Only a 401 tells that the session is gone. Server errors and rate limits must not sign
    // the user out locally.
    if (error && error.status !== 401) {
      throw new FollowAPIError(error.message || error.statusText, error.status)
    }
    const res = error ? null : data

    if (!res) {
      // Also in the database, or the next launch would start signed in as that user
      await userActions.removeCurrentUser()
      return null
    }

    if (!res.user) return res
    // The auth client does not know the fields the server adds to its user
    const user = apiMorph.toWhoami(res.user as unknown as AuthUser)
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

class UserActions implements Hydratable {
  async hydrate() {
    const users = await UserService.getUserAll()
    userActions.upsertManyInSession(users)
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
