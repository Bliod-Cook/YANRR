export interface SettingPageConfig {
  icon: string | React.ReactNode
  name: I18nKeysForSettings
  title?: I18nKeysForSettings
  priority: number
  headerIcon?: string | React.ReactNode
  hideIf?: () => boolean
  viewportClassName?: string
}
export const defineSettingPageData = (config: SettingPageConfig) => ({
  ...config,
})
