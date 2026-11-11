// @see https://github.com/Innei/sprightly/blob/2444dcdb789ca585337a4d241095640a524231db/src/lib/scroller.ts

import type { Transition } from "motion/react"
import { animateValue } from "motion/react"

const spring: Transition = {
  type: "spring",
  stiffness: 1000,
  damping: 250,
}
// TODO scroller lock
export const springScrollTo = (
  y: number,
  scrollerElement: HTMLElement = document.documentElement,
  // How far the target has moved since the scroll started
  getTargetShift = () => 0,
) => {
  const scrollTop = scrollerElement?.scrollTop

  let isStop = false
  const stopSpringScrollHandler = () => {
    isStop = true
    animation.stop()
  }

  const el = scrollerElement || window
  const animation = animateValue({
    keyframes: [scrollTop + 1, y],
    autoplay: true,
    ...spring,
    onPlay() {
      el.addEventListener("wheel", stopSpringScrollHandler, { capture: true })
      el.addEventListener("touchmove", stopSpringScrollHandler)
    },

    onUpdate(latest) {
      if (latest <= 0) {
        animation.stop()
        return
      }

      if (isStop) {
        return
      }

      el.scrollTo(0, latest + getTargetShift())
    },
  })

  animation.then(() => {
    el.removeEventListener("wheel", stopSpringScrollHandler, { capture: true })
    el.removeEventListener("touchmove", stopSpringScrollHandler)
  })

  return animation
}

export const springScrollToElement = (
  element: HTMLElement,
  delta = 40,

  scrollerElement: HTMLElement = document.documentElement,
) => {
  const y = calculateElementTop(element)

  const to = y + delta

  // Images that load above the element while scrolling push it down, so follow it
  return springScrollTo(
    to,
    scrollerElement || document.documentElement,
    () => calculateElementTop(element) - y,
  )
}

const calculateElementTop = (el: HTMLElement) => {
  let top = 0
  while (el) {
    top += el.offsetTop
    el = el.offsetParent as HTMLElement
  }
  return top
}
