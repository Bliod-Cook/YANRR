import { EmptyIcon } from "@follow/components/icons/empty.jsx"
import { Logo } from "@follow/components/icons/logo.jsx"
import { ScrollArea } from "@follow/components/ui/scroll-area/index.js"
import { useInputComposition } from "@follow/hooks"
import { getEntry } from "@follow/store/entry/getter"
import { entryActions, entrySyncServices, SEARCH_PAGE_SIZE } from "@follow/store/entry/store"
import type { EntriesPageParam, EntryModel } from "@follow/store/entry/types"
import { getFeedById } from "@follow/store/feed/getter"
import { useInboxById } from "@follow/store/inbox/hooks"
import { getAllFeedSubscription, getSubscriptionByFeedId } from "@follow/store/subscription/getter"
import { getUnreadById } from "@follow/store/unread/getters"
import { clsx, cn } from "@follow/utils/utils"
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"
import { Command } from "cmdk"
import type { FC, ReactNode } from "react"
import * as React from "react"
import { memo, useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useDebounceCallback } from "usehooks-ts"

import { setAppSearchOpen, useAppSearchOpen } from "~/atoms/app"
import { LoadMoreIndicator } from "~/components/common/LoadMoreIndicator"
import { useModalStack } from "~/components/ui/modal/stacked/hooks"
import { ROUTE_ENTRY_PENDING } from "~/constants"
import { useNavigateEntry } from "~/hooks/biz/useNavigateEntry"
import { FeedIcon } from "~/modules/feed/feed-icon"

import styles from "./cmdk.module.css"
import type { SearchableFeed } from "./match-feeds"
import { matchFeeds } from "./match-feeds"

/** How long typing pauses before a search */
const DEBOUNCE_MS = 300

/** The feeds the user follows, as the search looks at them */
const searchableFeeds = (): SearchableFeed[] =>
  getAllFeedSubscription().flatMap((subscription) => {
    if (!subscription.feedId) return []
    const feed = getFeedById(subscription.feedId)
    return [
      {
        id: subscription.feedId,
        names: [subscription.title, feed?.title].filter((name): name is string => !!name),
        addresses: [feed?.siteUrl, feed?.url].filter((address): address is string => !!address),
      },
    ]
  })

export const SearchCmdK: React.FC = () => {
  const { t } = useTranslation()
  const open = useAppSearchOpen()
  const [keyword, setKeyword] = useState("")
  // A stable callback keeps one debounced function, so that cancelling it reaches the call it holds.
  const search = useDebounceCallback(
    useCallback((value: string) => setKeyword(value.trim()), []),
    DEBOUNCE_MS,
  )

  const inputRef = React.useRef<HTMLInputElement>(null)
  const scrollViewRef = React.useRef<HTMLDivElement>(null)

  const { getTopModalStack } = useModalStack()

  React.useEffect(() => {
    const $input = inputRef.current
    if (open && $input) {
      $input.focus()
    }
  }, [open])

  // The input opens empty, so the search does too.
  React.useEffect(() => {
    if (!open) {
      search.cancel()
      setKeyword("")
    }
  }, [open, search])

  React.useEffect(() => {
    const $scrollView = scrollViewRef.current
    if ($scrollView) {
      $scrollView.scrollTop = 0
    }
  }, [keyword])

  const { onCompositionEnd, onCompositionStart, isCompositionRef } =
    useInputComposition<HTMLInputElement>({})
  const handleKeyDownToFocusInput: React.EventHandler<React.KeyboardEvent> = React.useCallback(
    (e) => {
      const $input = inputRef.current

      if (e.key === "Escape" && !isCompositionRef.current && !getTopModalStack()) {
        setAppSearchOpen(false)
        return
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") return

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        $input?.focus()
      }
    },
    [getTopModalStack, isCompositionRef],
  )

  const feeds = useMemo(() => (keyword ? matchFeeds(keyword, searchableFeeds()) : []), [keyword])
  const entries = useInfiniteQuery({
    queryKey: ["search", "entries", keyword],
    queryFn: ({ pageParam }) => entrySyncServices.searchEntries({ keyword, pageParam }),
    initialPageParam: undefined as EntriesPageParam | undefined,
    getNextPageParam: (page) => {
      const last = page.at(-1)
      if (page.length < SEARCH_PAGE_SIZE || !last) return
      return { time: last.publishedAt.toISOString(), id: last.id }
    },
    enabled: open && !!keyword,
    placeholderData: keepPreviousData,
    // Each search asks the server again: subscriptions and articles change in between.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
  const found = useMemo(
    () => (keyword ? (entries.data?.pages.flat() ?? []) : []),
    [entries.data, keyword],
  )

  return (
    <Command.Dialog
      shouldFilter={false}
      open={open}
      onKeyDown={handleKeyDownToFocusInput}
      onOpenChange={setAppSearchOpen}
      className={cn(
        "h-[600px] max-h-[80vh] w-[800px] max-w-[100vw] rounded-none md:h-screen md:max-h-[60vh] md:max-w-[80vw]",
        "flex min-h-[50vh] flex-col bg-material-ultra-thick shadow-2xl backdrop-blur-background md:rounded-xl",
        "border-0 border-border md:border",
        "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
      )}
    >
      <Command.Input
        className="w-full shrink-0 border-b border-border bg-transparent p-4 px-5 text-lg leading-4"
        ref={inputRef}
        placeholder={t("search.placeholder")}
        onValueChange={(value) => {
          if (!isCompositionRef.current) search(value)
        }}
        onCompositionStart={(event) => {
          onCompositionStart(event)
          search.cancel()
        }}
        onCompositionEnd={(event) => {
          onCompositionEnd(event)
          search(event.currentTarget.value)
        }}
      />
      <div className={cn(styles["status-bar"], entries.isFetching && styles["loading"])} />

      <div className="flex flex-1 flex-col overflow-y-hidden">
        <ScrollArea.ScrollArea
          ref={scrollViewRef}
          viewportClassName="max-h-[50vh] [&>div]:!flex"
          rootClassName="flex-1 px-5"
          scrollbarClassName="mb-6"
        >
          <Command.List className="flex w-full min-w-0 flex-col">
            <Command.Empty className="center absolute inset-0">
              {!keyword ? (
                <Logo className="size-12 opacity-80 grayscale" />
              ) : entries.isError || entries.isFetching ? null : (
                <SearchMessage>{t("search.empty.no_results")}</SearchMessage>
              )}
            </Command.Empty>
            {/* Shown even with matching feeds or earlier pages of articles */}
            {keyword && entries.isError && (
              <div className="center py-4 text-sm text-text-secondary">{t("search.error")}</div>
            )}

            {feeds.length > 0 && (
              <Command.Group
                heading={
                  <SearchGroupHeading
                    icon="i-mgc-rss-cute-fi size-4 text-accent"
                    title={t("search.group.feeds")}
                  />
                }
                className="py-2"
              >
                {feeds.map((feed) => (
                  <FeedItem key={feed.id} feedId={feed.id} />
                ))}
              </Command.Group>
            )}
            {found.length > 0 && (
              <Command.Group
                heading={
                  <SearchGroupHeading
                    icon="i-mgc-paper-cute-fi size-4"
                    title={t("search.group.entries")}
                  />
                }
                className="flex w-full min-w-0 flex-col py-2"
              >
                {found.map((entry) => (
                  <EntryItem key={entry.id} entry={entry} />
                ))}
              </Command.Group>
            )}
            {keyword && entries.hasNextPage && (
              <LoadMoreIndicator
                className="center w-full"
                onLoading={() => {
                  if (!entries.isFetchingNextPage) entries.fetchNextPage()
                }}
              />
            )}
          </Command.List>
        </ScrollArea.ScrollArea>
      </div>
    </Command.Dialog>
  )
}

const FeedItem = memo(function FeedItem({ feedId }: { feedId: string }) {
  const navigateEntry = useNavigateEntry()
  const feed = getFeedById(feedId)
  const subscription = getSubscriptionByFeedId(feedId)
  return (
    <SearchItem
      value={`feed-${feedId}`}
      title={subscription?.title || feed?.title || ""}
      subtitle={getUnreadById(feedId)?.toString()}
      icon={feed && <FeedIcon className="mr-2 size-5 shrink-0 rounded" target={feed} />}
      onSelect={() => {
        navigateEntry({ feedId, entryId: ROUTE_ENTRY_PENDING, view: subscription?.view })
      }}
    />
  )
})

const EntryItem = memo(function EntryItem({ entry }: { entry: EntryModel }) {
  const navigateEntry = useNavigateEntry()
  const inbox = useInboxById(entry.inboxHandle)
  const source = inbox ?? getFeedById(entry.feedId)
  return (
    <SearchItem
      value={`entry-${entry.id}`}
      title={entry.title ?? ""}
      subtitle={source?.title}
      icon={source && <FeedIcon className="mr-2 size-5 shrink-0 rounded" target={source} />}
      onSelect={() => {
        // The entry view reads the entry from the store, and only knows an inbox entry from it.
        if (!getEntry(entry.id)) entryActions.upsertManyInSession([entry])
        navigateEntry(
          entry.inboxHandle
            ? { inboxId: entry.inboxHandle, entryId: entry.id }
            : {
                feedId: entry.feedId,
                entryId: entry.id,
                view: getSubscriptionByFeedId(entry.feedId ?? undefined)?.view,
              },
        )
      }}
    />
  )
})

const SearchItem: FC<{
  value: string
  title: string
  subtitle?: Nullable<string>
  icon?: ReactNode
  onSelect: () => void
}> = ({ value, title, subtitle, icon, onSelect }) => (
  <Command.Item
    className={clsx(
      "relative flex w-full justify-between px-1 text-[0.9rem]",
      `before:absolute before:inset-0 before:rounded-md before:content-[""]`,
      "hover:before:bg-zinc-200/60 dark:hover:before:bg-zinc-800/80",
      "data-[selected=true]:before:bg-zinc-200/60 data-[selected=true]:dark:before:bg-zinc-800/80",
      "min-w-0 max-w-full",
      styles["content-visually"],
    )}
    value={value}
    onSelect={onSelect}
  >
    <div className="relative flex w-full items-center justify-between px-1 py-2">
      {icon}
      <span className="block min-w-0 flex-1 shrink-0 truncate">{title}</span>
      <span className="block min-w-0 shrink-0 grow-0 text-xs font-medium text-zinc-800 opacity-60 dark:text-slate-200/80">
        {subtitle}
      </span>
    </div>
  </Command.Item>
)

const SearchGroupHeading: FC<{ icon: string; title: string }> = ({ icon, title }) => (
  <div className="mb-2 flex items-center gap-2">
    <i className={icon} />
    <span className="text-sm font-semibold">{title}</span>
  </div>
)

const SearchMessage: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="flex flex-col items-center justify-center gap-2 opacity-80">
    <EmptyIcon />
    {children}
  </div>
)
