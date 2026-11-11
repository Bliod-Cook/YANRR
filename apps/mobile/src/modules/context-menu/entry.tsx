import type { FeedViewType } from "@follow/constants"
import { useIsEntryStarred } from "@follow/store/collection/hooks"
import { collectionSyncService } from "@follow/store/collection/store"
import { getEntry } from "@follow/store/entry/getter"
import { useEntry } from "@follow/store/entry/hooks"
import { getMarkReadTimeRange } from "@follow/store/entry/utils"
import { unreadSyncService } from "@follow/store/unread/store"
import { useIsLoggedIn } from "@follow/store/user/hooks"
import { PortalProvider } from "@gorhom/portal"
import type { PropsWithChildren } from "react"
import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Platform, Share, View } from "react-native"

import { useEffectiveEntrySortOrder } from "@/src/atoms/settings/general"
import { EntryContentWebView } from "@/src/components/native/webview/EntryContentWebView"
import { WebViewManager } from "@/src/components/native/webview/webview-manager"
import { ContextMenu } from "@/src/components/ui/context-menu"
import { Text } from "@/src/components/ui/typography/Text"
import { useNavigation } from "@/src/lib/navigation/hooks"
import { createLinkShareContent } from "@/src/lib/share"
import { toast } from "@/src/lib/toast"
import { useEntryExternalUrl } from "@/src/modules/entry-content/external-url"
import { EntryDetailScreen } from "@/src/screens/(stack)/entries/[entryId]/EntryDetailScreen"

import {
  getFetchEntryPayload,
  useIsTimelineEntrySource,
  useSelectedFeed,
  useSelectedView,
} from "../screen/atoms"

/** The mark-as-read item of an entry's menu, also used by the menus of its media */
export const useEntryReadMenuItem = (id: string) => {
  const { t } = useTranslation()
  const isLoggedIn = useIsLoggedIn()
  const read = useEntry(id, (state) => state.read)
  if (!isLoggedIn) return null
  return (
    <ContextMenu.Item
      key="MarkAsRead"
      onSelect={() => {
        read ? unreadSyncService.markEntryAsUnread(id) : unreadSyncService.markEntryAsRead(id)
      }}
    >
      <ContextMenu.ItemTitle>
        {read ? t("operation.mark_as_unread") : t("operation.mark_as_read")}
      </ContextMenu.ItemTitle>
      <ContextMenu.ItemIcon
        ios={{
          name: read ? "circle.fill" : "checkmark.circle",
        }}
      />
    </ContextMenu.Item>
  )
}

/** The star item of an entry's menu, also used by the menus of its media */
export const useEntryStarMenuItem = (id: string, view: FeedViewType) => {
  const { t } = useTranslation()
  const isLoggedIn = useIsLoggedIn()
  const feedId = useEntry(id, (state) => state.feedId)
  const isEntryStarred = useIsEntryStarred(id)
  if (!isLoggedIn || !feedId) return null
  return (
    <ContextMenu.Item
      key="Star"
      onSelect={() => {
        if (isEntryStarred) {
          collectionSyncService.unstarEntry({ entryId: id })
          toast.success(t("operation.unstar_success"))
        } else {
          collectionSyncService.starEntry({ entryId: id, view })
          toast.success(t("operation.star_success"))
        }
      }}
    >
      <ContextMenu.ItemIcon
        ios={{
          name: isEntryStarred ? "star.slash" : "star",
        }}
      />
      <ContextMenu.ItemTitle>
        {isEntryStarred ? t("operation.unstar") : t("operation.star")}
      </ContextMenu.ItemTitle>
    </ContextMenu.Item>
  )
}

export const EntryItemContextMenu = ({
  id,
  children,
  view,
  isTimelineSource: isTimelineSourceOverride,
}: PropsWithChildren<{
  id: string
  view: FeedViewType
  isTimelineSource?: boolean
}>) => {
  const { t } = useTranslation()
  const selectedView = useSelectedView()
  const selectedFeed = useSelectedFeed()
  const isLoggedIn = useIsLoggedIn()
  const currentIsTimelineSource = useIsTimelineEntrySource()
  const isTimelineSource = isTimelineSourceOverride ?? currentIsTimelineSource
  const sortOrder = useEffectiveEntrySortOrder({ isTimelineSource })
  const entry = useEntry(id, (state) => ({
    title: state.title,
    publishedAt: state.publishedAt,
  }))
  // Relative links resolve against the feed's site first
  const externalUrl = useEntryExternalUrl(id)
  const readItem = useEntryReadMenuItem(id)
  const starItem = useEntryStarMenuItem(id, view)
  const navigation = useNavigation()
  const handlePressPreview = useCallback(() => {
    if (entry) {
      const fullEntry = getEntry(id)
      if (fullEntry) {
        WebViewManager.setEntry(fullEntry)
      }
      navigation.pushControllerView(EntryDetailScreen, {
        entryId: id,
        view: view!,
      })
    }
  }, [entry, id, navigation, view])
  if (!entry) return null
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>

      <ContextMenu.Content>
        <ContextMenu.Preview size="STRETCH" onPress={handlePressPreview}>
          {() => (
            <PortalProvider>
              <View className="flex-1 bg-system-background">
                <Text
                  className="mt-5 px-5 py-4 text-2xl font-semibold text-label"
                  numberOfLines={2}
                >
                  {entry.title?.trim()}
                </Text>
                {/* The content has no side padding of its own; the entry screen gives it the same */}
                <View className="px-5">
                  <EntryContentWebView entryId={id} />
                </View>
              </View>
            </PortalProvider>
          )}
        </ContextMenu.Preview>

        {isLoggedIn && (
          <>
            <ContextMenu.Item
              key="MarkAsReadAbove"
              onSelect={() => {
                const payload = getFetchEntryPayload(selectedFeed, selectedView)
                const { publishedAt } = entry
                unreadSyncService.markBatchAsRead({
                  view: selectedView,
                  filter: payload,
                  time: getMarkReadTimeRange({
                    publishedAt,
                    position: "above",
                    sortOrder,
                  }),
                })
              }}
            >
              <ContextMenu.ItemIcon
                ios={{
                  name: "arrow.up",
                }}
              />
              <ContextMenu.ItemTitle>
                {t("operation.mark_all_as_read_which", {
                  which: t("operation.mark_all_as_read_which_above"),
                })}
              </ContextMenu.ItemTitle>
            </ContextMenu.Item>

            {readItem}

            <ContextMenu.Item
              key="MarkAsReadBelow"
              onSelect={() => {
                const payload = getFetchEntryPayload(selectedFeed, selectedView)
                const { publishedAt } = entry
                unreadSyncService.markBatchAsRead({
                  view: selectedView,
                  filter: payload,
                  time: getMarkReadTimeRange({
                    publishedAt,
                    position: "below",
                    sortOrder,
                  }),
                })
              }}
            >
              <ContextMenu.ItemIcon
                ios={{
                  name: "arrow.down",
                }}
              />
              <ContextMenu.ItemTitle>
                {t("operation.mark_all_as_read_which", {
                  which: t("operation.mark_all_as_read_which_below"),
                })}
              </ContextMenu.ItemTitle>
            </ContextMenu.Item>
          </>
        )}

        {starItem}

        {externalUrl && (
          <ContextMenu.Item
            key="Share"
            onSelect={async () => {
              await Share.share(
                createLinkShareContent({
                  platform: Platform.OS,
                  title: entry.title || t("operation.share_title.link"),
                  url: externalUrl,
                }),
              )
            }}
          >
            <ContextMenu.ItemIcon
              ios={{
                name: "square.and.arrow.up",
              }}
            />
            <ContextMenu.ItemTitle>{t("operation.share")}</ContextMenu.ItemTitle>
          </ContextMenu.Item>
        )}
      </ContextMenu.Content>
    </ContextMenu.Root>
  )
}
