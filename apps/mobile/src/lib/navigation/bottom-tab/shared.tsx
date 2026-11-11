import { useSetAtom } from "jotai"
import { use, useEffect } from "react"

import { ScreenItemContext } from "../ScreenItemContext"

export const LifecycleEvents = ({ isSelected }: { isSelected: boolean }) => {
  const { isFocusedAtom, isAppearedAtom, isDisappearedAtom } = use(ScreenItemContext)
  const setIsFocused = useSetAtom(isFocusedAtom)
  const setIsAppeared = useSetAtom(isAppearedAtom)
  const setIsDisappeared = useSetAtom(isDisappearedAtom)
  useEffect(() => {
    if (isSelected) {
      setIsFocused(true)
      setIsAppeared(true)
      setIsDisappeared(false)
    } else {
      setIsFocused(false)
      setIsAppeared(false)
      setIsDisappeared(true)
    }
  }, [isSelected, setIsAppeared, setIsDisappeared, setIsFocused])
  return null
}
