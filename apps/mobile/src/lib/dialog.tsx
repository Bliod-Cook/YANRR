import { cn } from "@follow/utils"
import { t } from "i18next"
import type { FC, ReactElement, ReactNode } from "react"
import { cloneElement, createElement, isValidElement } from "react"
import { Pressable, View } from "react-native"
import Animated, { SlideInUp, SlideOutUp } from "react-native-reanimated"
import RootSiblings from "react-native-root-siblings"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { ImageProps } from "react-native-svg"
import { useColor } from "react-native-uikit-colors"

import { Text } from "@/src/components/ui/typography/Text"
import { dialogCountAtom } from "@/src/lib/dialog-state"
import { jotaiStore } from "@/src/lib/jotai"

import { FullWindowOverlay } from "../components/common/FullWindowOverlay"
import { Overlay } from "../components/ui/overlay/Overlay"
import { Navigation } from "./navigation/Navigation"
import { NavigationInstanceContext } from "./navigation/NavigationInstanceContext"

export interface DialogProps<Ctx> {
  title?: string
  content: ReactNode
  variant?: "destructive" | "default"
  onClose?: (ctx: Ctx & DialogContextType) => void
  onConfirm?: (ctx: Ctx & DialogContextType) => void
  cancelText?: string
  confirmText?: string
  headerIcon?: ReactNode
  HeaderComponent?: FC<{
    title: string
    onClose: () => void
  }>
  id: string
}
interface ShowDialogOptions<Ctx> {
  override?: {
    onClose?: (ctx: Ctx & DialogContextType) => void
    onConfirm?: (ctx: Ctx & DialogContextType) => void
    cancelText?: string
    confirmText?: string
  }
}
const entering = SlideInUp.springify()
const exiting = SlideOutUp.duration(400)
type DialogContextType = {
  dismiss: () => void
}
export type DialogComponent<Ctx = unknown> = FC<{
  ctx: Ctx
}> &
  Omit<DialogProps<Ctx>, "content">
class DialogStatic {
  private currentStackedDialogs = new Set<string>()
  // Close handlers of the open dialogs, the topmost last
  private closeHandlers: Array<{ id: string; close: () => void }> = []

  /**
   * Closes the topmost dialog like its cancel button does. Returns false when none is open, so
   * the Android back button can fall through to the navigation.
   */
  dismissTop() {
    const top = this.closeHandlers.at(-1)
    if (!top) return false
    top.close()
    return true
  }

  show<Ctx>(
    propsOrComponent: DialogProps<Ctx> | DialogComponent<Ctx>,
    options?: ShowDialogOptions<Ctx>,
  ) {
    const isExist = this.currentStackedDialogs.has(propsOrComponent.id)
    const override = options?.override
    if (isExist) {
      return
    }
    const props =
      "content" in propsOrComponent
        ? propsOrComponent
        : (propsOrComponent as unknown as DialogProps<Ctx>)
    const dismiss = () => this.destroy(props.id, siblings)
    const mergeCtx = (ctx: Ctx): Ctx & DialogContextType => ({
      ...ctx,
      dismiss,
    })
    const ctx = {} as Ctx
    const children =
      "content" in propsOrComponent
        ? propsOrComponent.content
        : createElement(propsOrComponent, {
            ctx,
          })
    const handleClose = () => {
      dismiss()
      setTimeout(() => {
        if (override?.onClose) {
          override.onClose(mergeCtx(ctx))
        } else {
          props.onClose?.(mergeCtx(ctx))
        }
      }, 16)
    }
    const handleConfirm = () => {
      if (override?.onConfirm) {
        override.onConfirm(mergeCtx(ctx))
      } else {
        props.onConfirm?.(mergeCtx(ctx))
        handleClose()
      }
    }
    const Header = props.HeaderComponent ? (
      createElement(props.HeaderComponent, {
        title: props.title ?? "",
        onClose: handleClose,
      })
    ) : props.title ? (
      <DefaultHeader title={props.title} headerIcon={props.headerIcon} />
    ) : null
    const siblings = new RootSiblings(
      <NavigationInstanceContext value={Navigation.rootNavigation}>
        <FullWindowOverlay>
          <Overlay onPress={handleClose} />
          <Animated.View
            className="absolute inset-x-0 -top-8 z-10 bg-system-background pt-8"
            entering={entering}
            exiting={exiting}
          >
            <SafeInsetTop />
            {Header}
            <View className={cn("px-6 pb-4", Header ? "pt-4" : "pt-0")}>{children}</View>

            <View className="flex-row gap-4 px-6 pb-4">
              <DialogButton
                onPress={handleClose}
                text={override?.cancelText ?? props.cancelText ?? t("common:words.cancel")}
                textClassName={cn(props.variant === "destructive" && "font-bold")}
              />

              <DialogButton
                onPress={handleConfirm}
                text={override?.confirmText ?? props.confirmText ?? t("common:words.confirm")}
                className={props.variant === "destructive" ? "bg-red" : "bg-accent"}
                textClassName={cn("text-white", props.variant !== "destructive" && "font-bold")}
              />
            </View>
          </Animated.View>
        </FullWindowOverlay>
      </NavigationInstanceContext>,
    )
    this.currentStackedDialogs.add(props.id)
    this.closeHandlers.push({ id: props.id, close: handleClose })
    jotaiStore.set(dialogCountAtom, this.currentStackedDialogs.size)
    return siblings
  }
  destroy(id: string, siblings: RootSiblings) {
    this.currentStackedDialogs.delete(id)
    this.closeHandlers = this.closeHandlers.filter((handler) => handler.id !== id)
    jotaiStore.set(dialogCountAtom, this.currentStackedDialogs.size)
    siblings.destroy()
  }
}
const SafeInsetTop = () => {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{
        height: insets.top,
      }}
    />
  )
}
export const Dialog = new DialogStatic()
const DefaultHeader = (props: { title?: string; headerIcon?: ReactNode }) => {
  const label = useColor("label")
  if (!props.title) return null
  return (
    <View className="flex-row items-center gap-2 px-6">
      {isValidElement(props.headerIcon) &&
        props.headerIcon &&
        typeof props.headerIcon === "object" &&
        cloneElement(
          props.headerIcon as ReactElement,
          {
            color: label,
            height: 20,
            width: 20,
          } as Partial<ImageProps>,
        )}
      <Text className="text-lg font-semibold text-label">{props.title}</Text>
    </View>
  )
}
const DialogButton = (props: {
  text: string
  onPress: () => void
  className?: string
  textClassName?: string
}) => (
  <Pressable
    className={cn(
      "flex-1 items-center justify-center rounded-full bg-system-fill px-6 py-3",
      props.className,
    )}
    onPress={props.onPress}
  >
    <Text className={cn("text-base font-medium text-label", props.textClassName)}>
      {props.text}
    </Text>
  </Pressable>
)
