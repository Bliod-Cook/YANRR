/** The entries whose translation a list loads: none while it is inactive or the server has no AI */
export const getTranslationPrefetchIds = ({
  visibleIds,
  active,
  aiEnabled,
}: {
  visibleIds: string[]
  active?: boolean
  aiEnabled: boolean
}) => (active === false || !aiEnabled ? [] : visibleIds)
