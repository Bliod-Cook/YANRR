import { RootPortal } from "@follow/components/ui/portal/index.jsx"
import { PROD } from "@follow/shared/constants"
import { useWhoami } from "@follow/store/user/hooks"
import { preventDefault } from "@follow/utils/dom"
import type { PropsWithChildren } from "react"
import * as React from "react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Outlet } from "react-router"

import { setMainContainerElement, setRootContainerElement } from "~/atoms/dom"
import { useUISettingKey } from "~/atoms/settings/ui"
import { useLoginModalShow } from "~/atoms/user"
import { AppErrorBoundary } from "~/components/common/AppErrorBoundary"
import { ErrorComponentType } from "~/components/errors/enum"
import { PlainModal, PlainWithAnimationModal } from "~/components/ui/modal/stacked/custom-modal"
import { DeclarativeModal } from "~/components/ui/modal/stacked/declarative-modal"
import { ROOT_CONTAINER_ID } from "~/constants/dom"
import { getI18n } from "~/i18n"
import { EnvironmentIndicator } from "~/modules/app/EnvironmentIndicator"
import { LoginModalContent } from "~/modules/auth/LoginModalContent"
import { DebugRegistry } from "~/modules/debug/registry"
import { SearchCmdK } from "~/modules/panel/cmdk"
import { CmdNTrigger } from "~/modules/panel/cmdn"

import { SubscriptionColumnContainer } from "./subscription-column/SubscriptionColumn"

const errorTypes = [
  ErrorComponentType.Page,
  ErrorComponentType.FeedFoundCanBeFollow,
  ErrorComponentType.FeedNotFound,
] as ErrorComponentType[]

/**
 * Shell of the signed-in app: the subscription column on the left and the routed page
 * (`<Outlet />`) in the main area. It also shows the login modal when the session is lost.
 */
export function MainDestopLayout() {
  const { t } = useTranslation()
  const isAuthFail = useLoginModalShow()
  const user = useWhoami()

  const containerRef = useRef<HTMLDivElement | null>(null)

  return (
    <RootContainer ref={containerRef}>
      {!PROD && <EnvironmentIndicator />}

      <SubscriptionColumnContainer />

      <main
        ref={setMainContainerElement}
        className="flex min-w-0 flex-1 bg-theme-background pt-[calc(var(--fo-window-padding-top)_-10px)] !outline-none"
        // NOTE: tabIndex for main element can get by `document.activeElement`
        tabIndex={-1}
      >
        <AppErrorBoundary errorType={errorTypes}>
          <Outlet />
        </AppErrorBoundary>
      </main>

      {isAuthFail && !user && (
        <RootPortal>
          <DeclarativeModal
            id="login"
            defaultOpen
            CustomModalComponent={PlainModal}
            overlay
            title={t("words.login")}
            canClose={true}
            clickOutsideToDismiss={true}
          >
            <LoginModalContent canClose={true} />
          </DeclarativeModal>
        </RootPortal>
      )}

      <SearchCmdK />
      <CmdNTrigger />
    </RootContainer>
  )
}

/**
 * RootContainer Component
 *
 * The root container wrapper that:
 * - Sets up CSS custom properties for layout dimensions
 * - Provides the base container styling and dimensions
 * - Manages DOM element references for the layout system
 * - Handles context menu prevention and responsive behavior
 *
 * @param ref - Ref forwarded to the root div element
 * @param children - Child components to render within the container
 * @component
 */
const RootContainer = ({
  ref,
  children,
}: PropsWithChildren & { ref?: React.Ref<HTMLDivElement | null> }) => {
  const feedColWidth = useUISettingKey("feedColWidth")

  const [elementRef, _setElementRef] = useState<HTMLDivElement | null>(null)
  const setElementRef = React.useCallback((el: HTMLDivElement | null) => {
    _setElementRef(el)
    setRootContainerElement(el)
  }, [])
  React.useImperativeHandle(ref, () => elementRef!)
  return (
    <div
      ref={setElementRef}
      style={
        {
          "--fo-feed-col-w": `${feedColWidth}px`,
        } as any
      }
      className="relative z-0 flex h-screen overflow-hidden print:h-auto print:overflow-auto"
      onContextMenu={preventDefault}
      id={ROOT_CONTAINER_ID}
    >
      {children}
    </div>
  )
}

DebugRegistry.add("App Tip Dialog", () => {
  import("~/modules/app-tip/AppTipModalContent").then((m) => {
    window.presentModal({
      title: getI18n().t("app_tip.title"),
      content: () => <m.AppTipModalContent />,
      CustomModalComponent: PlainWithAnimationModal,
      modalContainerClassName: "flex items-center justify-center",
      modalClassName: "w-full max-w-5xl",
      canClose: true,
      clickOutsideToDismiss: false,
      overlay: false,
    })
  })
})
