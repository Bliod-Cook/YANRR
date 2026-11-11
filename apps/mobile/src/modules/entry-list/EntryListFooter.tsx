import { unreadSyncService } from "@follow/store/unread/store"
import { useTranslation } from "react-i18next"
import { Pressable, View } from "react-native"

import { PlatformActivityIndicator } from "@/src/components/ui/loading/PlatformActivityIndicator"
import { Text } from "@/src/components/ui/typography/Text"
import { CheckCircleCuteReIcon } from "@/src/icons/check_circle_cute_re"
import { useColor } from "@/src/theme/colors"

import { getFetchEntryPayload, useSelectedFeed, useSelectedView } from "../screen/atoms"
import type { TimelineEntries } from "../screen/timeline-entries"
import { EntryListEndScrollSpacer } from "./EntryListEndScrollSpacer"
import { ItemSeparator } from "./ItemSeparator"

/**
 * The end of a list of entries. When loading failed it offers to try again; otherwise it marks
 * the list read up to here, which only the server's list can bound by its entries.
 */
export const EntryListFooter = ({
  entries,
  separator,
}: {
  entries: TimelineEntries
  /** A line above it, as between the rows of a list */
  separator?: boolean
}) => (
  <View>
    {separator && <ItemSeparator />}
    {entries.error ? (
      <RetryLoading entries={entries} />
    ) : (
      entries.insertedBefore !== undefined && (
        <MarkAboveAsRead insertedBefore={entries.insertedBefore} />
      )
    )}
    <View className="h-px w-full bg-opaque-separator/70" collapsable={false} />
    <EntryListEndScrollSpacer />
  </View>
)

const RetryLoading = ({
  entries: { isFetchNextPageError, fetchNextPage, refetch, isFetching },
}: {
  entries: TimelineEntries
}) => {
  const { t } = useTranslation()
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isFetching}
      className="items-center justify-center py-6"
      onPress={() => void (isFetchNextPageError ? fetchNextPage() : refetch())}
    >
      {isFetching ? (
        <PlatformActivityIndicator />
      ) : (
        <Text className="text-secondary-label">{t("entry_list.load_failed_retry")}</Text>
      )}
    </Pressable>
  )
}

const MarkAboveAsRead = ({ insertedBefore }: { insertedBefore: number }) => {
  const { t } = useTranslation()
  const selectedView = useSelectedView()
  const selectedFeed = useSelectedFeed()
  const labelColor = useColor("label")
  return (
    <Pressable
      className="flex-row items-center justify-center gap-2 py-6"
      onPress={() => {
        unreadSyncService.markBatchAsRead({
          view: selectedView,
          filter: getFetchEntryPayload(selectedFeed, selectedView),
          time: { insertedBefore },
        })
      }}
    >
      <CheckCircleCuteReIcon height={16} width={16} color={labelColor} />
      <Text className="font-bold text-label">
        {t("operation.mark_all_as_read_which", {
          which: t("operation.mark_all_as_read_which_above"),
        })}
      </Text>
    </Pressable>
  )
}
