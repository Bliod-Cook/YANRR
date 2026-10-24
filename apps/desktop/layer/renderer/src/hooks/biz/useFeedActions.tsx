import { IN_ELECTRON } from "@follow/shared/constants"
import { getFeedById } from "@follow/store/feed/getter"
import { useFeedById } from "@follow/store/feed/hooks"
import { useInboxById, useIsInbox } from "@follow/store/inbox/hooks"
import {
  useCategoriesByView,
  useSubscriptionByFeedId,
  useSubscriptionsByFeedIds,
} from "@follow/store/subscription/hooks"
import { unreadSyncService } from "@follow/store/unread/store"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import type { FollowMenuItem, MenuItemInput } from "~/atoms/context-menu"
import { MenuItemSeparator, MenuItemText } from "~/atoms/context-menu"
import { useModalStack } from "~/components/ui/modal/stacked/hooks"
import { copyToClipboardWithFeedback } from "~/lib/clipboard"
import { INBOX_EMAIL_DOMAIN } from "~/lib/inbox"
import { COMMAND_ID } from "~/modules/command/commands/id"
import { useCommandShortcuts } from "~/modules/command/hooks/use-command-binding"
import { FeedForm } from "~/modules/discover/FeedForm"
import { InboxForm } from "~/modules/discover/InboxForm"
import { useConfirmUnsubscribeSubscriptionModal } from "~/modules/modal/hooks/useConfirmUnsubscribeSubscriptionModal"
import { useCategoryCreationModal } from "~/modules/subscription-column/CategoryCreationModalContent"

import { useBatchUpdateSubscription, useDeleteSubscription } from "./useSubscriptionActions"

export const useFeedActions = ({
  feedId,
  feedIds,
  view,
  type,
}: {
  feedId: string
  feedIds?: string[]
  view?: number
  type?: "feedList" | "entryList"
}) => {
  const { t } = useTranslation()
  const feed = useFeedById(feedId, (feed) => {
    return {
      type: feed.type,
      id: feed.id,
      url: feed.url,
      siteUrl: feed.siteUrl,
    }
  })

  const inbox = useInboxById(feedId)
  const isInbox = !!inbox
  const subscription = useSubscriptionByFeedId(feedId)

  const subscriptions = useSubscriptionsByFeedIds(
    useMemo(() => feedIds || [feedId], [feedId, feedIds]),
  )
  const { present } = useModalStack()
  const presentDeleteSubscription = useConfirmUnsubscribeSubscriptionModal()
  const deleteSubscription = useDeleteSubscription({})

  const isEntryList = type === "entryList"

  const { mutate: addFeedsToCategoryMutation } = useBatchUpdateSubscription()
  const presentCategoryCreationModal = useCategoryCreationModal()

  const categories = useCategoriesByView(view!)

  const isMultipleSelection = feedIds && feedIds.length > 1 && feedIds.includes(feedId)

  const shortcuts = useCommandShortcuts()

  const items = useMemo(() => {
    const related = feed || inbox
    if (!related) return []

    const items: MenuItemInput[] = [
      new MenuItemText({
        label: t("sidebar.feed_actions.mark_all_as_read"),
        shortcut: shortcuts[COMMAND_ID.subscription.markAllAsRead],
        disabled: isEntryList,
        click: () => unreadSyncService.markFeedAsRead(isMultipleSelection ? feedIds : [feedId]),
        supportMultipleSelection: true,
        requiresLogin: true,
      }),
      new MenuItemSeparator(isEntryList),
      new MenuItemText({
        label: isEntryList ? t("sidebar.feed_actions.edit_feed") : t("sidebar.feed_actions.edit"),
        shortcut: "E",
        disabled: isInbox,
        click: () => {
          present({
            modalContentClassName: "overflow-visible",
            title: t("sidebar.feed_actions.edit_feed"),
            content: ({ dismiss }) => <FeedForm id={feedId} onSuccess={dismiss} />,
          })
        },
        requiresLogin: true,
      }),
      new MenuItemText({
        label: isMultipleSelection
          ? t("sidebar.feed_actions.unfollow_feed_many")
          : isEntryList
            ? t("sidebar.feed_actions.unfollow_feed")
            : t("sidebar.feed_actions.unfollow"),
        shortcut: "$mod+Backspace",
        disabled: isInbox,
        supportMultipleSelection: true,
        click: () => {
          if (isMultipleSelection) {
            presentDeleteSubscription(feedIds)
            return
          }
          deleteSubscription.mutate({ subscription })
        },
        requiresLogin: true,
      }),
      new MenuItemSeparator(isEntryList),
      new MenuItemText({
        label: t("sidebar.feed_column.context_menu.add_feeds_to_category"),
        disabled: isInbox,
        supportMultipleSelection: true,
        requiresLogin: true,
        submenu: [
          ...Array.from(categories.values()).map((category) => {
            const isIncluded = isMultipleSelection
              ? subscriptions.every((s) => s!.category === category)
              : subscription?.category === category
            return new MenuItemText({
              label: category,
              checked: isIncluded,
              click() {
                addFeedsToCategoryMutation({
                  feedIdList: isMultipleSelection ? feedIds : [feedId],
                  category: isIncluded ? null : category, // if already included, remove it
                  view: view!,
                })
              },
              requiresLogin: true,
            })
          }),
          categories.size > 0 && MenuItemSeparator.default,
          new MenuItemText({
            label: t("sidebar.feed_column.context_menu.create_category"),
            icon: <i className="i-mingcute-add-line" />,
            click() {
              presentCategoryCreationModal(view!, isMultipleSelection ? feedIds : [feedId])
            },
            requiresLogin: true,
          }),
        ],
      }),
      new MenuItemSeparator(isEntryList),
      new MenuItemText({
        label: t("sidebar.feed_actions.open_site_in_browser", {
          which: t(IN_ELECTRON ? "words.browser" : "words.newTab"),
        }),
        shortcut: shortcuts[COMMAND_ID.subscription.openSiteInBrowser],
        disabled: isEntryList,
        click: () => {
          const feed = getFeedById(feedId)
          if (feed) {
            "siteUrl" in feed && feed.siteUrl && window.open(feed.siteUrl, "_blank")
          }
        },
      }),
      new MenuItemText({
        label: t("sidebar.feed_actions.copy_feed_id"),
        shortcut: "$mod+Shift+C",
        disabled: isEntryList,
        click: () => {
          void copyToClipboardWithFeedback(feedId)
        },
      }),
    ]

    return items.filter(
      (item) =>
        !isMultipleSelection ||
        (typeof item === "object" &&
          item !== null &&
          "supportMultipleSelection" in item &&
          item.supportMultipleSelection),
    )
  }, [
    addFeedsToCategoryMutation,
    categories,
    deleteSubscription,
    feed,
    feedId,
    feedIds,
    inbox,
    isEntryList,
    isInbox,
    isMultipleSelection,
    present,
    presentCategoryCreationModal,
    presentDeleteSubscription,
    shortcuts,
    subscription,
    subscriptions,
    t,
    view,
  ])

  return items
}

export const useInboxActions = ({ inboxId }: { inboxId: string }) => {
  const { t } = useTranslation()
  const isInbox = useIsInbox(inboxId)
  const { present } = useModalStack()

  const items = useMemo(() => {
    if (!isInbox) return []

    const items: FollowMenuItem[] = [
      new MenuItemText({
        label: t("sidebar.feed_actions.edit"),
        shortcut: "E",
        click: () => {
          present({
            title: t("sidebar.feed_actions.edit_inbox"),
            content: () => <InboxForm asWidget id={inboxId} />,
          })
        },
        requiresLogin: true,
      }),
      MenuItemSeparator.default,
      new MenuItemText({
        label: t("sidebar.feed_actions.copy_email_address"),
        shortcut: "$mod+Shift+C",
        click: () => {
          void copyToClipboardWithFeedback(`${inboxId}${INBOX_EMAIL_DOMAIN}`)
        },
      }),
    ]

    return items
  }, [isInbox, t, inboxId, present])

  return { items }
}
