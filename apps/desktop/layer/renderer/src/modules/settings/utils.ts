export interface SettingPageContext {
  isInMASReview: boolean
}

export interface SettingPageConfig {
  icon: string | React.ReactNode
  name: I18nKeysForSettings
  title?: I18nKeysForSettings
  priority: number
  headerIcon?: string | React.ReactNode
  hideIf?: (ctx: SettingPageContext) => boolean
  viewportClassName?: string
}
export const defineSettingPageData = (config: SettingPageConfig) => ({
  ...config,
})
