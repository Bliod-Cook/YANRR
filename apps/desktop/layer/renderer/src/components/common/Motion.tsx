import { m as M } from "motion/react"
import { createElement } from "react"

import { useReduceMotion } from "~/hooks/biz/useReduceMotion"

// The first seconds after navigation start are when the largest contentful paint happens
const LCP_WINDOW_MS = 3000
const isLCPEnded = () => performance.now() > LCP_WINDOW_MS

type WithLCPOptimization<P> = P & { lcpOptimization?: boolean }
// Narrow exported proxy type so each motion component accepts `lcpOptimization`
export type MotionProxy = {
  [K in keyof typeof M]: (typeof M)[K] extends React.ComponentType<infer P>
    ? React.ComponentType<WithLCPOptimization<P>>
    : (typeof M)[K]
}

const cacheMap = new Map<string, any>()
export const m: MotionProxy = new Proxy(M, {
  get(target, p: string) {
    const Component = target[p]

    if (cacheMap.has(p)) {
      return cacheMap.get(p)
    }
    const MotionComponent = ({ ref, lcpOptimization, ...props }) => {
      const shouldReduceMotion = useReduceMotion()
      const nextProps = { ...props }
      if (shouldReduceMotion) {
        // Keep the animated values, which carry state, and only skip the movement between them
        nextProps.transition = { duration: 0 }
      }

      // Disable initial animation before hydration ends to optimize LCP
      if (lcpOptimization && !isLCPEnded()) {
        nextProps.initial = false
      }

      return createElement(Component, { ...nextProps, ref })
    }

    cacheMap.set(p, MotionComponent)

    return MotionComponent
  },
})
