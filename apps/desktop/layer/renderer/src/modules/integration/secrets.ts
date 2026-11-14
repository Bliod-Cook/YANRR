import { IN_ELECTRON } from "@follow/shared/constants"
import type { CustomIntegration, IntegrationSettings } from "@follow/shared/settings/interface"
import { useQuery } from "@tanstack/react-query"
import { useCallback } from "react"

import {
  getIntegrationSettings,
  setIntegrationSetting,
  useIntegrationSettingKey,
  useIntegrationSettingValue,
} from "~/atoms/settings/integration"
import { ipcServices } from "~/lib/client"
import { queryClient } from "~/lib/query-client"

// The desktop app keeps the tokens and passwords of the integrations, and the headers of custom
// HTTP integrations, in the main process, encrypted. The web app has no safer place than its
// storage, where they stay as settings.

/** The settings that hold a token or a password */
const INTEGRATION_SECRET_KEYS = [
  "cuboxToken",
  "instapaperPassword",
  "outlineToken",
  "qbittorrentPassword",
  "readeckToken",
  "readwiseToken",
  "zoteroToken",
] as const satisfies readonly (keyof IntegrationSettings)[]

export type IntegrationSecretKey = (typeof INTEGRATION_SECRET_KEYS)[number]

const secretId = (key: IntegrationSecretKey) => `integration.${key}`
const headersSecretId = (integrationId: string) => `integration.custom.${integrationId}.headers`

/** The ids of the stored secrets; below it, by setting, the value of each */
const SECRETS_QUERY_KEY = ["integration-secrets"]
const PERSISTENT_QUERY_KEY = ["integration-secrets-persistent"]

// Only called in the desktop app, which has the bridge
const mainProcess = () => ipcServices!.secret

const hasHeaders = (integration: CustomIntegration) =>
  Object.keys(integration.fetchTemplate?.headers ?? {}).length > 0

/** Whether `settings` hold a token, a password or custom headers, as the web app's always may */
export const holdsIntegrationSecrets = (settings: Partial<IntegrationSettings>) =>
  INTEGRATION_SECRET_KEYS.some((key) => !!settings[key]) ||
  !!settings.customIntegration?.some(hasHeaders)

export const readIntegrationSecret = async (key: IntegrationSecretKey): Promise<string> =>
  IN_ELECTRON ? ((await mainProcess().get(secretId(key))) ?? "") : getIntegrationSettings()[key]

export const writeIntegrationSecret = async (key: IntegrationSecretKey, value: string) => {
  if (!IN_ELECTRON) {
    setIntegrationSetting(key, value)
    return
  }
  queryClient.setQueryData([...SECRETS_QUERY_KEY, key], value)
  await (value ? mainProcess().set(secretId(key), value) : mainProcess().delete(secretId(key)))
  // Kept in the settings where the system has no key store; it would come back on the next launch
  if (getIntegrationSettings()[key]) setIntegrationSetting(key, "")
  await queryClient.invalidateQueries({ queryKey: SECRETS_QUERY_KEY, exact: true })
}

/** Whether a token or password is set, by the setting that holds it */
export const useHasIntegrationSecret = () => {
  const settings = useIntegrationSettingValue()
  const { data: storedIds } = useQuery({
    queryKey: SECRETS_QUERY_KEY,
    queryFn: () => mainProcess().keys(),
    enabled: IN_ELECTRON,
  })

  return useCallback(
    (key: IntegrationSecretKey) =>
      IN_ELECTRON ? !!storedIds?.includes(secretId(key)) : !!settings[key],
    [settings, storedIds],
  )
}

/** A token or password, for an input that edits it with `writeIntegrationSecret` */
export const useIntegrationSecret = (key: IntegrationSecretKey) => {
  const setting = useIntegrationSettingKey(key)
  const { data: stored = "" } = useQuery({
    queryKey: [...SECRETS_QUERY_KEY, key],
    queryFn: () => readIntegrationSecret(key),
    enabled: IN_ELECTRON,
    staleTime: Infinity,
  })
  return IN_ELECTRON ? stored : setting
}

/** False in a desktop app whose system has no key store: secrets last until it quits */
export const useIntegrationSecretsPersistent = () =>
  useQuery({
    queryKey: PERSISTENT_QUERY_KEY,
    queryFn: () => mainProcess().isPersistent(),
    enabled: IN_ELECTRON,
  }).data ?? true

export const readCustomIntegrationHeaders = async (
  integration: CustomIntegration,
): Promise<Record<string, string>> => {
  if (!IN_ELECTRON) return integration.fetchTemplate?.headers ?? {}
  const stored = await mainProcess().get(headersSecretId(integration.id))
  return stored ? JSON.parse(stored) : {}
}

/** Stores the integration's headers as a secret, in the desktop app; answers what remains */
export const storeCustomIntegrationSecrets = async (
  integration: CustomIntegration,
): Promise<CustomIntegration> => {
  if (!IN_ELECTRON || !integration.fetchTemplate) return integration

  const id = headersSecretId(integration.id)
  await (hasHeaders(integration)
    ? mainProcess().set(id, JSON.stringify(integration.fetchTemplate.headers))
    : mainProcess().delete(id))
  return { ...integration, fetchTemplate: { ...integration.fetchTemplate, headers: {} } }
}

export const deleteCustomIntegrationSecrets = async (integrationId: string) => {
  if (IN_ELECTRON) await mainProcess().delete(headersSecretId(integrationId))
}

/**
 * Stores the tokens, passwords and custom headers found in `settings` as secrets, in the desktop
 * app, and answers the settings without them. An empty value leaves a stored secret as it is.
 */
export const takeIntegrationSecrets = async (
  settings: Partial<IntegrationSettings>,
): Promise<Partial<IntegrationSettings>> => {
  if (!IN_ELECTRON) return settings

  const rest = { ...settings }
  for (const key of INTEGRATION_SECRET_KEYS) {
    const value = settings[key]
    if (!value) continue
    await mainProcess().set(secretId(key), value)
    rest[key] = ""
  }
  if (settings.customIntegration?.some(hasHeaders)) {
    rest.customIntegration = await Promise.all(
      settings.customIntegration.map((integration) =>
        hasHeaders(integration) ? storeCustomIntegrationSecrets(integration) : integration,
      ),
    )
  }
  await queryClient.invalidateQueries({ queryKey: SECRETS_QUERY_KEY })
  return rest
}

/**
 * Start-up: moves the secrets that versions before kept in the page's storage, or that a failed
 * move left there, to the main process. Where the system has no key store, the main process
 * keeps them only until the app quits, so they stay in the page's storage as well, to be taken
 * again on the next launch.
 */
export const moveIntegrationSecretsToMainProcess = async () => {
  if (!IN_ELECTRON) return

  const settings = getIntegrationSettings()
  const rest = await takeIntegrationSecrets(settings)
  if (!(await mainProcess().isPersistent())) return
  for (const [key, value] of Object.entries(rest)) {
    const settingKey = key as keyof IntegrationSettings
    if (value !== settings[settingKey]) setIntegrationSetting(settingKey, value as never)
  }
}

/** Sign-out: the secrets belong to the account */
export const clearIntegrationSecrets = async () => {
  if (IN_ELECTRON) await mainProcess().clear()
}
