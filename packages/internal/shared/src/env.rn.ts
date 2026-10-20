/**
 * This env for apps/mobile
 */
import { DEFAULT_VALUES } from "./env.common"

const profile = "prod"

const envProfileMap = {
  prod: {
    API_URL: DEFAULT_VALUES.PROD.API_URL,
    WEB_URL: DEFAULT_VALUES.PROD.WEB_URL,
    OTA_URL: DEFAULT_VALUES.PROD.OTA_URL,
  },
  dev: {
    API_URL: DEFAULT_VALUES.DEV.API_URL,
    WEB_URL: DEFAULT_VALUES.DEV.WEB_URL,
    OTA_URL: DEFAULT_VALUES.DEV.OTA_URL,
  },
  staging: {
    API_URL: DEFAULT_VALUES.STAGING.API_URL,
    WEB_URL: DEFAULT_VALUES.STAGING.WEB_URL,
    OTA_URL: DEFAULT_VALUES.STAGING.OTA_URL,
  },
  local: {
    API_URL: DEFAULT_VALUES.LOCAL.API_URL,
    WEB_URL: DEFAULT_VALUES.LOCAL.WEB_URL,
    OTA_URL: DEFAULT_VALUES.LOCAL.OTA_URL,
  },
}
export const getEnvProfiles__dangerously = () => envProfileMap
export type { envProfileMap }
/**
 * @deprecated
 * @description this env always use prod env, please use `proxyEnv` to access dynamic env
 */
export const env = {
  WEB_URL: envProfileMap[profile].WEB_URL,
  API_URL: envProfileMap[profile].API_URL,
  OTA_URL: envProfileMap[profile].OTA_URL,
}
