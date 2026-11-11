import Constants from "expo-constants"

interface AppExtra {
  e2eLanguage?: unknown
}

const getAppExtra = (): AppExtra => (Constants.expoConfig?.extra ?? {}) as AppExtra

// The native app config turns the `null` defaults into `{}`, so only a non-empty string counts
const asSetting = (value: unknown) => (typeof value === "string" && value ? value : null)

export const getE2ELanguage = () =>
  asSetting(getAppExtra().e2eLanguage) ?? asSetting(process.env.EXPO_PUBLIC_E2E_LANGUAGE)

/** E2E builds always fix the language they run in */
export const isE2EBuild = () => getE2ELanguage() !== null
