import { normalizeFeedAddress } from "@follow/utils/feed-address"
import { useQuery } from "@tanstack/react-query"
import { useAtomValue } from "jotai"
import { useTranslation } from "react-i18next"
import { useWindowDimensions, View } from "react-native"

import { Text } from "@/src/components/ui/typography/Text"
import { followClient } from "@/src/lib/api-client"

import { useSearchPageContext } from "../ctx"
import { ItemSeparator } from "./__base"
import { SearchErrorView, useDataSkeleton } from "./hooks"
import { SearchFeedCard } from "./SearchFeedCard"

export const SearchFeed = () => {
  const { t } = useTranslation("common")
  const { searchValueAtom } = useSearchPageContext()
  const searchValue = useAtomValue(searchValueAtom)
  const windowWidth = useWindowDimensions().width
  // Discovery takes addresses only, such as feed and site URLs and RSSHub routes
  const isAddress = normalizeFeedAddress(searchValue) !== null
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["searchFeed", searchValue],
    queryFn: () => {
      return followClient.api.discover.discover({ keyword: searchValue })
    },
    enabled: isAddress,
  })
  const items = data?.data ?? []
  // A retry after an error has no data either and shows the spinner again; an address the
  // server found no feed at says that nothing was found
  const skeleton = useDataSkeleton(
    isFetching && data === undefined,
    data === undefined ? undefined : items.length,
  )
  if (searchValue && !isAddress) {
    return <Text className="px-6 pt-4 text-text/60">{t("validation.invalid_url")}</Text>
  }
  if (skeleton) return skeleton
  if (data === undefined) {
    return error ? <SearchErrorView error={error} onRetry={() => void refetch()} /> : null
  }

  return (
    <View
      style={{
        width: windowWidth,
      }}
    >
      <Text className="px-6 pt-4 text-text/60">
        {t("discover.search.results", { count: items.length })}
      </Text>
      <View>
        {items.map(
          ({ feed }) =>
            feed && (
              <View key={feed.id}>
                <SearchFeedCard feed={feed} />
                <ItemSeparator />
              </View>
            ),
        )}
      </View>
    </View>
  )
}
