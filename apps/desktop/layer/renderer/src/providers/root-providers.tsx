import { GlobalFocusableProvider } from "@follow/components/common/Focusable/GlobalFocusableProvider.js"
import { MotionProvider } from "@follow/components/common/MotionProvider.jsx"
import { EventProvider } from "@follow/components/providers/event-provider.js"
import { StableRouterProvider } from "@follow/components/providers/stable-router-provider.js"
import { Toaster } from "@follow/components/ui/toast/index.jsx"
import { TooltipProvider } from "@follow/components/ui/tooltip/index.jsx"
import { IN_ELECTRON } from "@follow/shared/constants"
import { QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { Provider } from "jotai"
import type { FC, PropsWithChildren } from "react"
import { Suspense } from "react"

import { ModalStackProvider } from "~/components/ui/modal"
import { jotaiStore } from "~/lib/jotai"
import { queryClient } from "~/lib/query-client"
import { FollowCommandManager } from "~/modules/command/command-manager"

import { ApiConnectionProvider } from "./api-connection-provider"
import { ExtensionExposeProvider } from "./extension-expose-provider"
import { HotkeyProvider } from "./hotkey-provider"
import { I18nProvider } from "./i18n-provider"
import { ImageProxyProvider } from "./image-proxy-provider"
import { InvalidateQueryProvider } from "./invalidate-query-provider"
import { LazyContextMenuProvider, LazyPopoverProvider, LazyPWAPrompt } from "./lazy/index"
import { ServerConfigsProvider } from "./server-configs-provider"
import { SettingSync } from "./setting-sync"
import { UserProvider } from "./user-provider"

export const RootProviders: FC<PropsWithChildren> = ({ children }) => (
  <Provider store={jotaiStore}>
    <MotionProvider>
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <GlobalFocusableProvider>
            <HotkeyProvider>
              <I18nProvider>
                <ModalStackProvider>
                  <Toaster />
                  <ApiConnectionProvider />
                  <EventProvider />

                  <UserProvider />
                  <ServerConfigsProvider />
                  <ImageProxyProvider />

                  <StableRouterProvider />
                  <SettingSync />
                  <FollowCommandManager />
                  <ExtensionExposeProvider />

                  {import.meta.env.DEV && <Devtools />}

                  {children}
                  <Suspense>
                    <LazyContextMenuProvider />
                    <LazyPopoverProvider />
                    {!IN_ELECTRON && <LazyPWAPrompt />}
                  </Suspense>
                </ModalStackProvider>
              </I18nProvider>
            </HotkeyProvider>
          </GlobalFocusableProvider>

          <InvalidateQueryProvider />
        </QueryClientProvider>
      </TooltipProvider>
    </MotionProvider>
  </Provider>
)

const Devtools = () =>
  !IN_ELECTRON && (
    <div className="hidden lg:block print:hidden">
      <ReactQueryDevtools buttonPosition="bottom-left" client={queryClient} />
    </div>
  )
