import type { FeedViewType } from "@follow/constants"
import { useIsEntryStarred } from "@follow/store/collection/hooks"
import { collectionSyncService } from "@follow/store/collection/store"
import { useEntry } from "@follow/store/entry/hooks"
import { unreadSyncService } from "@follow/store/unread/store"
import { useIsLoggedIn } from "@follow/store/user/hooks"
import type { PropsWithChildren } from "react"
import { useTranslation } from "react-i18next"
import { Pressable } from "react-native"

import { toast } from "@/src/lib/toast"

import { ContextMenu } from "../context-menu"
import { shareImage, useSaveImageToMediaLibrary } from "./utils"

type ImageContextMenuProps = PropsWithChildren<{
  imageUrl?: string
  entryId?: string
  view?: FeedViewType
}>

export const ImageContextMenu = ({ imageUrl, entryId, children, view }: ImageContextMenuProps) => {
  const { t } = useTranslation()
  const isLoggedIn = useIsLoggedIn()
  const entry = useEntry(entryId, (state) => ({
    read: state.read,
    feedId: state.feedId,
  }))
  const feedId = entry?.feedId

  const isEntryStarred = useIsEntryStarred(entryId!)

  const saveImageToAlbum = useSaveImageToMediaLibrary()

  if (!imageUrl || !entry) {
    return children
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <Pressable>{children}</Pressable>
      </ContextMenu.Trigger>

      <ContextMenu.Content>
        {isLoggedIn && entryId && feedId && view !== undefined && (
          <>
            <ContextMenu.Item
              key="MarkAsRead"
              onSelect={() => {
                entry.read
                  ? unreadSyncService.markEntryAsUnread(entryId)
                  : unreadSyncService.markEntryAsRead(entryId)
              }}
            >
              <ContextMenu.ItemTitle>
                {entry.read ? t("operation.mark_as_unread") : t("operation.mark_as_read")}
              </ContextMenu.ItemTitle>
              <ContextMenu.ItemIcon
                ios={{
                  name: entry.read ? "circle.fill" : "checkmark.circle",
                }}
              />
            </ContextMenu.Item>
            <ContextMenu.Item
              key="Star"
              onSelect={() => {
                if (isEntryStarred) {
                  collectionSyncService.unstarEntry({ entryId })
                  toast.success(t("operation.unstar_success"))
                } else {
                  collectionSyncService.starEntry({
                    entryId,
                    view,
                  })
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
          </>
        )}

        <ContextMenu.Item key="Save" onSelect={() => saveImageToAlbum(imageUrl)}>
          <ContextMenu.ItemTitle>{t("image.save_to_album")}</ContextMenu.ItemTitle>
          <ContextMenu.ItemIcon
            ios={{
              name: "square.and.arrow.down",
            }}
          />
        </ContextMenu.Item>
        <ContextMenu.Item key="Share" onSelect={() => shareImage(imageUrl)}>
          <ContextMenu.ItemIcon
            ios={{
              name: "square.and.arrow.up",
            }}
          />
          <ContextMenu.ItemTitle>{t("operation.share")}</ContextMenu.ItemTitle>
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  )
}
