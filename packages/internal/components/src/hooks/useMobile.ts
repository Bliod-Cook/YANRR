import { useViewport } from "./useViewport"

const selectIsMobile = (v: { w: number }) => v.w < 1024 && v.w !== 0

export const useMobile = () => {
  return useViewport(selectIsMobile)
}

export const isMobile = () => {
  const w = window.innerWidth
  return w < 1024 && w !== 0
}
