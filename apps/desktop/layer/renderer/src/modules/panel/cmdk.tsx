import { EmptyIcon } from "@follow/components/icons/empty.jsx"
import { Logo } from "@follow/components/icons/logo.jsx"
import { Kbd } from "@follow/components/ui/kbd/Kbd.js"
import { ScrollArea } from "@follow/components/ui/scroll-area/index.js"
import { FeedViewType, getView } from "@follow/constants"
import { useInputComposition } from "@follow/hooks"
import { getEntry } from "@follow/store/entry/getter"
import { entryActions, entrySyncServices, SEARCH_PAGE_SIZE } from "@follow/store/entry/store"
import type { EntriesPageParam } from "@follow/store/entry/types"
import { getFeedById } from "@follow/store/feed/getter"
import { useFeedById } from "@follow/store/feed/hooks"
import { getAllFeedSubscription, getSubscriptionByFeedId } from "@follow/store/subscription/getter"
import { getUnreadById } from "@follow/store/unread/getters"
import { clsx, cn } from "@follow/utils/utils"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Command } from "cmdk"
import type { FC, ReactNode } from "react"
import * as React from "react"
import { memo, useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useDebounceCallback } from "usehooks-ts"

import { setAppSearchOpen, useAppSearchOpen, useAppSearchScope } from "~/atoms/app"
import { LoadMoreIndicator } from "~/components/common/LoadMoreIndicator"
import { useModalStack } from "~/components/ui/modal/stacked/hooks"
import {
  FEED_COLLECTION_LIST,
  ROUTE_ENTRY_PENDING,
  ROUTE_FEED_IN_FOLDER,
  ROUTE_FEED_PENDING,
} from "~/constants"
import { useNavigateEntry } from "~/hooks/biz/useNavigateEntry"
import { FeedIcon } from "~/modules/feed/feed-icon"
import { useTimelineTitle } from "~/store/feed/hooks"

import styles from "./cmdk.module.css"
import type { SearchableFeed } from "./match-feeds"
import { matchFeeds } from "./match-feeds"
import type { SearchScope } from "./search-scope"
import { searchScopeParams } from "./search-scope"

/** How long typing pauses before a search */
const DEBOUNCE_MS = 300
/** The value of the result row of a feed */
const FEED_ITEM_PREFIX = "feed-"

type SearchResult = Awaited<ReturnType<typeof entrySyncServices.searchEntries>>[number]

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

/** A key telling scopes apart */
const scopeKey = (scope: SearchScope | null) =>
  scope ? `${scope.view}/${scope.feedId}/${scope.inboxId ?? ""}` : ""

export const SearchCmdK: React.FC = () => {
  const { t } = useTranslation()
  const open = useAppSearchOpen()
  const [scope, setScope] = useAppSearchScope()
  const [input, setInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [selected, setSelected] = useState("")
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

  // The input opens empty and unscoped, so the search does too.
  React.useEffect(() => {
    if (!open) {
      search.cancel()
      setInput("")
      setKeyword("")
      setScope(null)
    }
  }, [open, search, setScope])

  React.useEffect(() => {
    const $scrollView = scrollViewRef.current
    if ($scrollView) {
      $scrollView.scrollTop = 0
    }
  }, [keyword, scope])

  const scopeTo = useCallback(
    (next: SearchScope | null) => {
      setScope(next)
      search.cancel()
      setInput("")
      setKeyword("")
      inputRef.current?.focus()
    },
    [search, setScope],
  )
  const scopeToFeed = useCallback(
    (feedId: string) =>
      scopeTo({ view: getSubscriptionByFeedId(feedId)?.view ?? FeedViewType.All, feedId }),
    [scopeTo],
  )

  const { onCompositionEnd, onCompositionStart, isCompositionRef } =
    useInputComposition<HTMLInputElement>({})
  const handleKeyDownToFocusInput: React.EventHandler<React.KeyboardEvent> = React.useCallback(
    (e) => {
      const $input = inputRef.current

      if (e.key === "Escape" && !isCompositionRef.current && !getTopModalStack()) {
        setAppSearchOpen(false)
        return
      }

      if (e.key === "Tab" && !isCompositionRef.current) {
        // Nothing in the dialog takes the focus but the input.
        e.preventDefault()
        if (selected.startsWith(FEED_ITEM_PREFIX) && !e.shiftKey) {
          scopeToFeed(selected.slice(FEED_ITEM_PREFIX.length))
        }
        return
      }

      if (e.key === "Backspace" && scope && !input && !isCompositionRef.current) {
        scopeTo(null)
        return
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") return

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        $input?.focus()
      }
    },
    [getTopModalStack, input, isCompositionRef, scope, scopeTo, scopeToFeed, selected],
  )

  const feeds = useMemo(() => (keyword ? matchFeeds(keyword, searchableFeeds()) : []), [keyword])
  const entries = useInfiniteQuery({
    queryKey: ["search", "entries", scopeKey(scope), keyword],
    queryFn: ({ pageParam }) =>
      entrySyncServices.searchEntries({
        keyword,
        pageParam,
        scope: scope ? searchScopeParams(scope) : undefined,
      }),
    initialPageParam: undefined as EntriesPageParam | undefined,
    getNextPageParam: (page) => {
      const last = page.at(-1)?.entry
      if (page.length < SEARCH_PAGE_SIZE || !last) return
      return { time: last.publishedAt.toISOString(), id: last.id }
    },
    enabled: open && !!keyword,
    // Results of another scope would show under this one.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === scopeKey(scope) ? previous : undefined,
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
      value={selected}
      onValueChange={setSelected}
      onKeyDown={handleKeyDownToFocusInput}
      onOpenChange={setAppSearchOpen}
      className={cn(
        "h-[600px] max-h-[80vh] w-[800px] max-w-[100vw] rounded-none md:h-screen md:max-h-[60vh] md:max-w-[80vw]",
        "flex min-h-[50vh] flex-col bg-material-ultra-thick shadow-2xl backdrop-blur-background md:rounded-xl",
        "border-0 border-border md:border",
        "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
      )}
    >
      <div className="flex shrink-0 items-center border-b border-border">
        {scope && <SearchScopeChip scope={scope} onClear={() => scopeTo(null)} />}
        <Command.Input
          className={cn(
            "min-w-0 flex-1 bg-transparent p-4 text-lg leading-4",
            scope ? "pl-3 pr-5" : "px-5",
          )}
          ref={inputRef}
          placeholder={t("search.placeholder")}
          value={input}
          onValueChange={(value) => {
            setInput(value)
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
      </div>
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
                  <FeedItem key={feed.id} feedId={feed.id} onScope={scopeToFeed} />
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
                {found.map((result) => (
                  <EntryItem key={result.entry.id} {...result} />
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

/** The timeline the search is narrowed to, named as its header names it */
const SearchScopeChip: FC<{ scope: SearchScope; onClear: () => void }> = ({ scope, onClear }) => {
  const { t } = useTranslation()
  const title = useTimelineTitle(scope.feedId, scope.view)
  return (
    <div className="ml-4 flex min-w-0 max-w-[40%] shrink-0 items-center gap-1.5 rounded-md bg-fill-secondary py-1 pl-2 pr-1 text-sm">
      <SearchScopeIcon scope={scope} />
      <span className="truncate">{title}</span>
      <button
        type="button"
        aria-label={t("search.scope.clear")}
        className="center size-5 shrink-0 rounded text-text-secondary hover:bg-fill"
        onClick={onClear}
      >
        <i className="i-mgc-close-cute-re size-3.5" />
      </button>
    </div>
  )
}

const SearchScopeIcon: FC<{ scope: SearchScope }> = ({ scope: { view, feedId, inboxId } }) => {
  const feed = useFeedById(feedId)
  if (inboxId) return <i className="i-mgc-inbox-cute-fi shrink-0" />
  if (feedId === FEED_COLLECTION_LIST) {
    return <i className="i-mgc-star-cute-fi shrink-0 text-amber-500" />
  }
  if (feedId.startsWith(ROUTE_FEED_IN_FOLDER)) {
    return <i className="i-mgc-folder-open-cute-re shrink-0" />
  }
  if (feedId === ROUTE_FEED_PENDING) return getView(view).icon
  return feed ? <FeedIcon className="shrink-0 rounded" target={feed} size={16} noMargin /> : null
}

const FeedItem = memo(function FeedItem({
  feedId,
  onScope,
}: {
  feedId: string
  onScope: (feedId: string) => void
}) {
  const { t } = useTranslation()
  const navigateEntry = useNavigateEntry()
  const feed = getFeedById(feedId)
  const subscription = getSubscriptionByFeedId(feedId)
  return (
    <SearchItem
      value={`${FEED_ITEM_PREFIX}${feedId}`}
      title={subscription?.title || feed?.title || ""}
      subtitle={getUnreadById(feedId)?.toString()}
      icon={feed && <FeedIcon className="mr-2 size-5 shrink-0 rounded" target={feed} />}
      action={
        <button
          type="button"
          aria-label={t("search.scope.in_feed")}
          title={t("search.scope.in_feed")}
          className="ml-2 hidden shrink-0 group-data-[selected=true]:flex"
          onClick={(event) => {
            // Not the row's own action, which opens the feed
            event.stopPropagation()
            onScope(feedId)
          }}
        >
          <Kbd wrapButton={false}>Tab</Kbd>
        </button>
      }
      onSelect={() => {
        navigateEntry({ feedId, entryId: ROUTE_ENTRY_PENDING, view: subscription?.view })
      }}
    />
  )
})

const EntryItem = memo(function EntryItem({ entry, highlight, source }: SearchResult) {
  const navigateEntry = useNavigateEntry()
  return (
    <SearchItem
      value={`entry-${entry.id}`}
      title={<Marked pieces={highlight.title} />}
      snippet={highlight.snippet && <Marked pieces={highlight.snippet} />}
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
  title: ReactNode
  /** Under the title, e.g. where an entry matched */
  snippet?: ReactNode
  subtitle?: Nullable<string>
  /** At the end of the row while it is selected */
  action?: ReactNode
  icon?: ReactNode
  onSelect: () => void
}> = ({ value, title, snippet, subtitle, action, icon, onSelect }) => (
  <Command.Item
    className={clsx(
      "group relative flex w-full justify-between px-1 text-[0.9rem]",
      `before:absolute before:inset-0 before:rounded-md before:content-[""]`,
      "hover:before:bg-zinc-200/60 dark:hover:before:bg-zinc-800/80",
      "data-[selected=true]:before:bg-zinc-200/60 data-[selected=true]:dark:before:bg-zinc-800/80",
      "min-w-0 max-w-full",
      styles["content-visually"],
    )}
    value={value}
    onSelect={onSelect}
  >
    <div className="relative flex w-full items-start px-1 py-2">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="block min-w-0 flex-1 truncate">{title}</span>
          <span className="block min-w-0 shrink-0 grow-0 text-xs font-medium text-zinc-800 opacity-60 dark:text-slate-200/80">
            {subtitle}
          </span>
          {action}
        </div>
        {snippet && (
          <p className="mt-0.5 line-clamp-2 break-words text-xs text-text-secondary">{snippet}</p>
        )}
      </div>
    </div>
  </Command.Item>
)

/** Text cut into pieces, every other one from the second a match */
const Marked: FC<{ pieces: string[] }> = ({ pieces }) =>
  pieces.map((piece, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="bg-transparent font-semibold text-accent">
        {piece}
      </mark>
    ) : (
      piece
    ),
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
