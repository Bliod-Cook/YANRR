import { LoadingCircle } from "@follow/components/ui/loading/index.jsx"
import type { TFunction } from "i18next"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { useAuthQuery } from "~/hooks/common"
import { Queries } from "~/queries"

import type { RouteParams } from "./DiscoverFeedForm"
import { DiscoverFeedForm } from "./DiscoverFeedForm"

const getTransformRouteParams = (t: TFunction<"app">): RouteParams => ({
  title: {
    description: t("discover.transform.params.title"),
    default: t("discover.transform.defaults.title"),
  },
  item: { description: t("discover.transform.params.item"), default: "html" },
  itemTitle: {
    description: t("discover.transform.params.item_title"),
    default: t("discover.transform.defaults.item_element"),
  },
  itemTitleAttr: {
    description: t("discover.transform.params.item_title_attr"),
    default: t("discover.transform.defaults.element_text"),
  },
  itemLink: {
    description: t("discover.transform.params.item_link"),
    default: t("discover.transform.defaults.item_element"),
  },
  itemLinkAttr: { description: t("discover.transform.params.item_link_attr"), default: "href" },
  itemDesc: {
    description: t("discover.transform.params.item_desc"),
    default: t("discover.transform.defaults.item_element"),
  },
  itemDescAttr: {
    description: t("discover.transform.params.item_desc_attr"),
    default: t("discover.transform.defaults.element_html"),
  },
  itemPubDate: {
    description: t("discover.transform.params.item_pub_date"),
    default: t("discover.transform.defaults.item_element"),
  },
  itemPubDateAttr: {
    description: t("discover.transform.params.item_pub_date_attr"),
    default: t("discover.transform.defaults.element_html"),
  },
  itemContent: {
    description: t("discover.transform.params.item_content"),
  },
  encoding: { description: t("discover.transform.params.encoding"), default: "utf-8" },
})

export function DiscoverTransform() {
  const { t } = useTranslation()
  const transformRouteParams = useMemo(() => getTransformRouteParams(t), [t])
  const { data, isLoading } = useAuthQuery(
    Queries.discover.rsshubNamespace({
      namespace: "rsshub",
    }),
    {
      meta: {
        persist: true,
      },
    },
  )

  if (isLoading) {
    return (
      <div className="center mt-12 flex w-full flex-col gap-8">
        <LoadingCircle size="large" />
      </div>
    )
  }

  // Missing when the server cannot reach RSSHub or the instance has no such route
  const route = data?.rsshub?.routes["/transform/html/:url/:routeParams"]
  if (!route) {
    return (
      <p className="mt-12 text-center text-sm text-text-secondary">
        {t("discover.transform.unavailable")}
      </p>
    )
  }

  return (
    <div className="w-full pt-6">
      <DiscoverFeedForm
        routePrefix="rsshub"
        route={route}
        routeParams={transformRouteParams}
        noDescription
        viewportClassName="pt-0 max-h-none"
      />
    </div>
  )
}
