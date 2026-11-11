import { IN_ELECTRON } from "@follow/shared/constants"
import { useEffect, useRef } from "react"

declare const APP_NAME: string

export const useTitle = (title?: string | null) => {
  const currentTitleRef = useRef(document.title)
  useEffect(() => {
    if (!title) return

    document.title = IN_ELECTRON ? title : `${title} | ${APP_NAME}`
    return () => {
      document.title = currentTitleRef.current
    }
  }, [title])
}
