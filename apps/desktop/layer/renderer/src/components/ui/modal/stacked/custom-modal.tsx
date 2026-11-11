import { Spring } from "@follow/components/constants/spring.js"
import { m } from "motion/react"
import type { PropsWithChildren } from "react"

export const PlainModal = ({ children }: PropsWithChildren) => children

export const PlainWithAnimationModal = ({ children }: PropsWithChildren) => {
  return (
    <m.div
      initial={true}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={Spring.presets.smooth}
    >
      {children}
    </m.div>
  )
}

export { PlainModal as NoopChildren }
