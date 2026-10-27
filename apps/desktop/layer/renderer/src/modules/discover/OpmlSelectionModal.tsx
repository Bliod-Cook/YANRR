import { Button } from "@follow/components/ui/button/index.js"
import { Checkbox } from "@follow/components/ui/checkbox/index.jsx"
import { Input } from "@follow/components/ui/input/index.js"
import { ScrollArea } from "@follow/components/ui/scroll-area/index.js"
import { getFeedById } from "@follow/store/feed/getter"
import { getAllFeedSubscription } from "@follow/store/subscription/getter"
import { importOpmlInBatches } from "@follow/store/subscription/opml-import"
import { subscriptionSyncService } from "@follow/store/subscription/store"
import { cn } from "@follow/utils/utils"
import type { ExtractResponseData, SubscriptionParseOpmlResponse } from "@follow-app/client-sdk"
import { useMutation } from "@tanstack/react-query"
import Fuse from "fuse.js"
import { useCallback, useMemo, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useCurrentModal } from "~/components/ui/modal/stacked/hooks"
import { toastFetchError } from "~/lib/error-parser"

import type { OpmlImportResult } from "./opml-import"
import { addFollowedToImportResult, splitFollowedOpmlItems } from "./opml-import"
import type { ParsedFeedItem } from "./types"

const getFollowedFeedIdByUrl = () => {
  const feedIdByUrl = new Map<string, string>()
  for (const { feedId } of getAllFeedSubscription()) {
    const url = getFeedById(feedId)?.url
    if (feedId && url) feedIdByUrl.set(url, feedId)
  }
  return feedIdByUrl
}

export const OpmlSelectionModal = ({
  parsedData,

  file,
}: {
  parsedData: ExtractResponseData<SubscriptionParseOpmlResponse>

  file: File
}) => {
  const { dismiss } = useCurrentModal()
  const [progress, setProgress] = useState<{ done: number; total: number }>()

  const importMutation = useMutation({
    mutationFn: async (selectedItems: ParsedFeedItem[]): Promise<OpmlImportResult> => {
      const { followed, rest } = splitFollowedOpmlItems(selectedItems, getFollowedFeedIdByUrl())
      // Nothing new to import, and the server fails on an import without a new feed
      if (rest.length === 0) {
        return { successfulItems: [], conflictItems: followed, parsedErrorItems: [] }
      }

      const total = rest.length
      setProgress({ done: 0, total })
      const data = await importOpmlInBatches(
        file,
        rest.map((item) => item.url),
        (done) => setProgress({ done, total }),
      )

      return addFollowedToImportResult(data, followed)
    },
    onSuccess: (data) => {
      // The import is logged per feed, so the delta feed delivers exactly what was added.
      void subscriptionSyncService.refresh(undefined, { afterServerChange: true })

      const { successfulItems, conflictItems, parsedErrorItems } = data

      if (parsedErrorItems.length > 0) {
        toast.warning(t("discover.import.import_completed_with_issues"), {
          description: (
            <Trans
              ns="app"
              i18nKey="discover.import.result"
              components={{
                SuccessfulNum: <NumberDisplay value={successfulItems.length} />,
                ConflictNum: <NumberDisplay value={conflictItems.length} />,
                ErrorNum: <NumberDisplay value={parsedErrorItems.length} />,
                br: <br />,
              }}
            />
          ),
          duration: 5000,
        })
      } else {
        dismiss()
        // Show success if everything went well
        toast.success(t("discover.import.import_successful"), {
          description: (
            <Trans
              ns="app"
              i18nKey="discover.import.result"
              components={{
                SuccessfulNum: <NumberDisplay value={successfulItems.length} />,
                ConflictNum: <NumberDisplay value={conflictItems.length} />,
                ErrorNum: <NumberDisplay value={parsedErrorItems.length} />,
                br: <br />,
              }}
            />
          ),
          duration: 5000,
        })
      }
    },
    async onError(err) {
      toastFetchError(err)
    },
  })

  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedItems, setSelectedItems] = useState<Set<string>>(
    () => new Set(parsedData.subscriptions.map((_, index) => index.toString())),
  )

  const fuse = useMemo(() => {
    return new Fuse(parsedData.subscriptions, {
      keys: [
        { name: "title", weight: 0.7 },
        { name: "url", weight: 0.2 },
        { name: "category", weight: 0.1 },
      ],
      threshold: 0.3,
      includeMatches: true,
      minMatchCharLength: 2,
    })
  }, [parsedData.subscriptions])

  const filteredSubscriptions = useMemo(() => {
    if (!searchQuery.trim()) {
      return parsedData.subscriptions.map((item, index) => ({ item, refIndex: index }))
    }

    return fuse.search(searchQuery).map((result) => ({
      item: result.item,
      refIndex: result.refIndex,
    }))
  }, [fuse, searchQuery, parsedData.subscriptions])

  const toggleItem = useCallback((index: string) => {
    setSelectedItems((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(index)) {
        newSet.delete(index)
      } else {
        newSet.add(index)
      }
      return newSet
    })
  }, [])

  const toggleAll = useCallback(
    (checked: boolean) => {
      const filteredIndices = filteredSubscriptions.map(({ refIndex }) => refIndex.toString())
      setSelectedItems((prev) => {
        const newSet = new Set(prev)
        for (const index of filteredIndices) {
          if (checked) newSet.add(index)
          else newSet.delete(index)
        }
        return newSet
      })
    },
    [filteredSubscriptions],
  )

  const handleImport = useCallback(() => {
    const selected = parsedData.subscriptions.filter((_, index) =>
      selectedItems.has(index.toString()),
    )
    importMutation.mutate(selected)
  }, [parsedData.subscriptions, selectedItems, importMutation])

  // Calculate selection states for filtered items
  const filteredSelectedCount = filteredSubscriptions.filter(({ refIndex }) =>
    selectedItems.has(refIndex.toString()),
  ).length

  const allFilteredSelected =
    filteredSelectedCount === filteredSubscriptions.length && filteredSubscriptions.length > 0
  const someFilteredSelected =
    filteredSelectedCount > 0 && filteredSelectedCount < filteredSubscriptions.length

  return (
    <div className="flex h-full max-w-full flex-col">
      <div className="mb-4">
        <h3 className="mb-2 text-lg font-semibold">
          {t("discover.import.select_feeds_to_import")}
        </h3>
        <p className="text-sm text-text-secondary">
          {t("discover.import.select_feeds_description")}
        </p>
      </div>

      {/* Search Input */}
      <div className="mb-4">
        <Input
          placeholder={t("discover.import.search_feeds_placeholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full"
        />
      </div>

      <label
        className="mb-4 flex items-center gap-3 rounded-lg px-1 py-2"
        htmlFor="select-all-filtered-feeds"
      >
        <Checkbox
          id="select-all-filtered-feeds"
          checked={allFilteredSelected}
          onCheckedChange={toggleAll}
          indeterminate={someFilteredSelected}
        />
        <span className="font-medium">
          {searchQuery.trim() ? (
            <>
              {t("discover.import.select_all_filtered")} ({filteredSelectedCount}/
              {filteredSubscriptions.length})
              {filteredSubscriptions.length < parsedData.subscriptions.length && (
                <span className="ml-1 text-text-secondary">
                  {t("discover.import.total_count", { total: parsedData.subscriptions.length })}
                </span>
              )}
            </>
          ) : (
            <>
              {t("discover.import.select_all_feeds")} ({selectedItems.size}/
              {parsedData.subscriptions.length})
            </>
          )}
        </span>
      </label>

      <ScrollArea.ScrollArea rootClassName="-mx-4 flex-1 px-2">
        <div className="space-y-2">
          {filteredSubscriptions.length === 0 && searchQuery.trim() ? (
            <div className="py-8 text-center text-text-secondary">
              {t("discover.import.no_feeds_found")}
            </div>
          ) : (
            filteredSubscriptions.map(({ item, refIndex }) => {
              const isSelected = selectedItems.has(refIndex.toString())

              return (
                <div
                  key={`${item.url}-${refIndex}`}
                  className={cn(
                    "flex cursor-button items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-material-medium",
                    isSelected ? "border-material-thick bg-material-thick" : "border-background",
                  )}
                  onClick={() => toggleItem(refIndex.toString())}
                >
                  <Checkbox checked={isSelected} />
                  <div className="min-w-0 flex-1 shrink">
                    <div className="truncate font-medium">
                      {item.title || t("discover.import.untitled_feed")}
                    </div>
                    <div className="truncate text-sm text-text-secondary">{item.url}</div>
                    {item.category && (
                      <div className="mt-1 text-xs text-text-secondary opacity-80">
                        {item.category}
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea.ScrollArea>

      <div className="mt-4 flex justify-end gap-3">
        <Button variant="outline" onClick={dismiss} disabled={importMutation.isPending}>
          {t("words.cancel", { ns: "common" })}
        </Button>
        <Button
          onClick={handleImport}
          disabled={selectedItems.size === 0 || importMutation.isPending}
          isLoading={importMutation.isPending}
        >
          {t("words.import")} (
          {importMutation.isPending && progress
            ? `${progress.done}/${progress.total}`
            : selectedItems.size}
          )
        </Button>
      </div>
    </div>
  )
}

const NumberDisplay = ({ value }) => <span className="font-bold text-text">{value ?? 0}</span>
