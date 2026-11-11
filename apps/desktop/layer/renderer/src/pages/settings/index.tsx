import { getStableRouterNavigate } from "@follow/components/atoms/route.js"
import { nextFrame } from "@follow/utils/dom"
import { useLayoutEffect } from "react"

export const Component = () => {
  useLayoutEffect(() => {
    nextFrame(() => getStableRouterNavigate()?.("/settings/general"))
  }, [])
  return null
}
