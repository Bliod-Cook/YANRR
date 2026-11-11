import { useRefValue } from "@follow/hooks/shared"
import { createAtomHooks } from "@follow/utils"
import { EventBus } from "@follow/utils/event-bus"
import type { SetStateAction, WritableAtom } from "jotai"
import { atom as jotaiAtom, useAtomValue } from "jotai"
import { atomWithStorage, selectAtom } from "jotai/utils"
import { useMemo } from "react"
import { shallow } from "zustand/shallow"

import { JotaiPersistSyncStorage } from "../../../lib/jotai"
import { getSettingStorageKey } from "./storage"

type Nullable<T> = T | null | undefined

export const createSettingAtom = <T extends object>(
  settingKey: string,
  createDefaultSettings: () => T,
) => {
  const atom = atomWithStorage(
    getSettingStorageKey(settingKey),
    createDefaultSettings(),
    JotaiPersistSyncStorage,
    {
      getOnInit: true,
    },
  ) as WritableAtom<T, [SetStateAction<T>], void>

  const [, , useSettingValue, , getSettings, setSettings] = createAtomHooks(atom)

  const initializeDefaultSettings = () => {
    const currentSettings = getSettings()
    const defaultSettings = createDefaultSettings()
    if (typeof currentSettings !== "object") setSettings(defaultSettings)
    const newSettings = { ...defaultSettings, ...currentSettings }
    setSettings(newSettings)
  }

  const selectAtomCacheMap = {} as Record<keyof ReturnType<typeof getSettings>, any>

  const noopAtom = jotaiAtom(null)

  const useMaybeSettingKey = <T extends keyof ReturnType<typeof getSettings>>(key: Nullable<T>) => {
    // @ts-expect-error
    let selectedAtom: Record<keyof T, any>[T] | null = null
    if (key) {
      selectedAtom = selectAtomCacheMap[key]
      if (!selectedAtom) {
        selectedAtom = selectAtom(atom, (s) => s[key])
        selectAtomCacheMap[key] = selectedAtom
      }
    } else {
      selectedAtom = noopAtom
    }

    return useAtomValue(selectedAtom) as ReturnType<typeof getSettings>[T]
  }

  const useSettingKey = <T extends keyof ReturnType<typeof getSettings>>(key: T) => {
    return useMaybeSettingKey(key) as ReturnType<typeof getSettings>[T]
  }

  const useSettingSelector = <
    T extends keyof ReturnType<typeof getSettings>,
    S extends ReturnType<typeof getSettings>,
    R = S[T],
  >(
    selector: (s: S) => R,
  ): R => {
    const stableSelector = useRefValue(selector)

    return useAtomValue(
      useMemo(
        () => selectAtom(atom, (state) => stableSelector.current(state as S), shallow),
        [stableSelector],
      ),
    )
  }

  const setSetting = <K extends keyof ReturnType<typeof getSettings>>(
    key: K,
    value: ReturnType<typeof getSettings>[K],
  ) => {
    setSettings({ ...getSettings(), [key]: value })

    EventBus.dispatch("SETTING_CHANGE_EVENT", { key: settingKey, payload: { [key]: value } })
  }

  Object.defineProperty(useSettingValue, "select", {
    value: useSettingSelector,
  })

  return {
    useSettingKey,
    useSettingSelector,
    setSetting,
    initializeDefaultSettings,

    useSettingValue,
    getSettings,

    settingAtom: atom,
  } as {
    useSettingKey: typeof useSettingKey
    useSettingSelector: typeof useSettingSelector
    setSetting: typeof setSetting
    initializeDefaultSettings: typeof initializeDefaultSettings
    useSettingValue: typeof useSettingValue & {
      select: <T extends keyof ReturnType<() => T>>(key: T) => Awaited<T[T]>
    }
    getSettings: typeof getSettings
    settingAtom: typeof atom
  }
}
