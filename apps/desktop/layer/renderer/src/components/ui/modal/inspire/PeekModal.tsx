import { getStableRouterNavigate } from "@follow/components/atoms/route.js"
import { RootPortalContext } from "@follow/components/ui/portal/provider.js"
import type { PropsWithChildren, ReactNode } from "react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { m } from "~/components/common/Motion"
import { GlassButton } from "~/components/ui/button/GlassButton"

import { FixedModalCloseButton } from "../components/close"
import { useCurrentModal, useModalStack } from "../stacked/hooks"
import { InPeekModal } from "./InPeekModal"

interface PeekModalProps {
  to?: string
  rightActions?: {
    onClick: () => void
    label: string
    icon: ReactNode
  }[]
}

export const PeekModal = (props: PropsWithChildren<PeekModalProps>) => {
  const { dismissAll } = useModalStack()

  const { to, children } = props
  const { t } = useTranslation("common")
  const { dismiss } = useCurrentModal()
  const [rootRef, setRootRef] = useState<HTMLDivElement | null>(null)

  return (
    <RootPortalContext value={rootRef as HTMLElement}>
      <div
        className="relative mx-auto mt-[10vh] scrollbar-none max-w-full overflow-hidden px-2 lg:max-w-[65rem] lg:p-0"
        ref={setRootRef}
      >
        <m.div
          exit={{ opacity: 0, y: 50 }}
          transition={{ duration: 0.2 }}
          className="scrollbar-none motion-preset-slide-up overflow-hidden motion-ease-spring-smooth motion-duration-200"
        >
          <InPeekModal value={true}>{children}</InPeekModal>
        </m.div>
        <m.div
          initial={true}
          exit={{
            opacity: 0,
          }}
          className="fixed safe-inset-top-4 right-4 flex items-center gap-4"
        >
          {props.rightActions?.map((action) => (
            <GlassButton
              key={action.label}
              onClick={action.onClick}
              description={action.label}
              size="md"
            >
              {action.icon}
            </GlassButton>
          ))}
          {!!to && (
            <GlassButton
              onClick={() => {
                dismissAll()

                getStableRouterNavigate()?.(to)
              }}
              description={t("words.expand")}
              size="md"
            >
              <i className="i-mgc-fullscreen-2-cute-re text-lg" />
            </GlassButton>
          )}
          <FixedModalCloseButton onClick={dismiss} />
        </m.div>
      </div>
    </RootPortalContext>
  )
}
