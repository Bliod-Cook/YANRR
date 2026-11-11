import { jotaiStore } from "@follow/utils"
import { atom, Provider } from "jotai"
import RootSiblings from "react-native-root-siblings"

import { FullWindowOverlay } from "../../common/FullWindowOverlay"
import { dismissToast } from "./state"
import { ToastContainer } from "./ToastContainer"
import type { ToastProps } from "./types"

export class ToastManager {
  private toastAtom = atom<ToastProps | null>(null)
  private portal: RootSiblings | null = null
  private lastId = 0

  private mount() {
    this.portal = new RootSiblings(
      <FullWindowOverlay>
        <Provider store={jotaiStore}>
          <ToastContainer toastAtom={this.toastAtom} />
        </Provider>
      </FullWindowOverlay>,
    )
  }

  /** Shows a toast in the middle of the screen, in place of the one shown before. */
  show(props: Partial<Omit<ToastProps, "id">>) {
    if (!this.portal) {
      this.mount()
    }

    const toast: ToastProps = {
      duration: 3000,
      type: "info",
      message: "",
      ...props,
      id: ++this.lastId,
    }
    jotaiStore.set(this.toastAtom, toast)

    const dismiss = () => jotaiStore.set(this.toastAtom, (shown) => dismissToast(shown, toast.id))
    if (toast.duration !== Infinity) {
      setTimeout(dismiss, toast.duration)
    }
    return dismiss
  }
}
