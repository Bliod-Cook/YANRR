import type { FC } from "react"

import type { ServerConfigs } from "~/atoms/server-configs"
import { useFeature } from "~/hooks/biz/useFeature"

export const featureConfigMap = {
  ai: "AI_CHAT_ENABLED",
} satisfies Record<string, keyof ServerConfigs>

export const withFeature =
  (feature: keyof typeof featureConfigMap) =>
  <T extends object>(Component: FC<T>, FallbackComponent: FC<T>) => {
    const WithFeature = ({ ...props }: T) => {
      const isEnabled = useFeature(feature)

      return isEnabled ? <Component {...props} /> : <FallbackComponent {...props} />
    }

    return WithFeature
  }
