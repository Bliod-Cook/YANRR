import { produce } from "immer"
import type { StateCreator } from "zustand"
import { devtools } from "zustand/middleware"
import { shallow } from "zustand/shallow"
import type { UseBoundStoreWithEqualityFn } from "zustand/traditional"
import { createWithEqualityFn } from "zustand/traditional"

declare const window: any

const storeMap = {} as Record<string, UseBoundStoreWithEqualityFn<any>>

export const createZustandStore =
  <S, T extends StateCreator<S, [], []> = StateCreator<S, [], []>>(name: string) =>
  (store: T) => {
    const newStore = import.meta.env.DEV
      ? createWithEqualityFn(
          devtools(store, {
            enabled: DEBUG,
            name,
          }),
          shallow,
        )
      : createWithEqualityFn(store, shallow)

    storeMap[name] = newStore

    window.store =
      window.store ||
      new Proxy(
        {},
        {
          get(_, prop) {
            if (prop in storeMap) {
              return new Proxy(() => {}, {
                get() {
                  return storeMap[prop as string].getState()
                },
                apply(target, thisArg, argumentsList) {
                  return storeMap[prop as string].setState(
                    produce(storeMap[prop as string].getState(), ...argumentsList),
                  )
                },
              })
            }
            return
          },
        },
      )

    window[`store_${name}`] = newStore

    return newStore
  }
