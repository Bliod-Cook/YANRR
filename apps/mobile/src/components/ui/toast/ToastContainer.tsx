import type { Atom } from "jotai"
import { useAtomValue } from "jotai"
import { View } from "react-native"

import { CenteredToast } from "./CenteredToast"
import type { ToastProps } from "./types"

export const ToastContainer = ({ toastAtom }: { toastAtom: Atom<ToastProps | null> }) => {
  const toast = useAtomValue(toastAtom)

  if (!toast) {
    return null
  }

  return (
    <View className="absolute inset-0 items-center justify-center px-5" pointerEvents="box-none">
      <CenteredToast {...toast} />
    </View>
  )
}
