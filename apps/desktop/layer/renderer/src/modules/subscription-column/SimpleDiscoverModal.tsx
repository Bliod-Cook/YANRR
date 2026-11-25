import { Button } from "@follow/components/ui/button/index.js"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@follow/components/ui/form/index.jsx"
import { Input } from "@follow/components/ui/input/index.js"
import { SegmentGroup, SegmentItem } from "@follow/components/ui/segment/index.js"
import { normalizeFeedAddress } from "@follow/utils/feed-address"
import type { DiscoveryItem } from "@follow-app/client-sdk"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import i18next from "i18next"
import { atom, useAtomValue, useStore } from "jotai"
import { useCallback, useState } from "react"
import { useForm } from "react-hook-form"
import { Trans, useTranslation } from "react-i18next"
import { Link } from "react-router"
import { z } from "zod"

import { useModalStack } from "~/components/ui/modal/stacked/hooks"
import { followClient } from "~/lib/api-client"
import { createErrorToaster } from "~/lib/error-parser"

import { DiscoverFeedCard } from "../discover/DiscoverFeedCard"
import { FeedForm } from "../discover/FeedForm"
import { isDiscoveredFeedItself } from "../discover/utils"

const formSchema = z
  .object({
    keyword: z.string(),
    type: z.enum(["rss", "rsshub"]),
  })
  // A feed or site address may leave out `https://`; an RSSHub route names its scheme
  .refine(
    ({ keyword, type }) =>
      normalizeFeedAddress(keyword) !== null &&
      (type === "rss" || keyword.trim().startsWith("rsshub://")),
    { path: ["keyword"], error: () => i18next.t("validation.invalid_url", { ns: "common" }) },
  )

const typeConfig = {
  rss: {
    label: "discover.rss_url",
    placeholder: "example.com/feed.xml",
  },
  rsshub: {
    label: "discover.rss_hub_route",
    placeholder: "rsshub://github/issue/follow/follow",
  },
} as const

export function SimpleDiscoverModal({ dismiss }: { dismiss: () => void }) {
  const { t } = useTranslation()
  const { present } = useModalStack()
  const jotaiStore = useStore()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      keyword: "",
      type: "rss",
    },
  })

  const watchedType = form.watch("type")
  const currentConfig = typeConfig[watchedType]

  const discoverSearchDataAtom = useState(() => atom<DiscoveryItem[]>())[0]
  const discoverSearchData = useAtomValue(discoverSearchDataAtom)

  const presentFeedForm = (url: string) =>
    present({
      title: t("feed_form.add_feed"),
      content: ({ dismiss: dismissFeedForm }) => (
        <FeedForm
          url={url}
          onSuccess={() => {
            dismissFeedForm()
            dismiss()
          }}
        />
      ),
    })

  const mutation = useMutation({
    mutationFn: async ({ keyword, type }: z.infer<typeof formSchema>) => {
      const url = normalizeFeedAddress(keyword)!
      if (type === "rsshub") {
        presentFeedForm(url)
        return
      }

      // The address may be a site rather than a feed, so discovery looks for the site's feeds
      const { data } = await followClient.api.discover.discover({ keyword: url })
      if (isDiscoveredFeedItself(data, url)) {
        presentFeedForm(url)
        return
      }
      jotaiStore.set(discoverSearchDataAtom, data)
    },
    onError: createErrorToaster(t("discover.search_failed")),
  })

  const handleTypeChange = useCallback(
    (value: string) => {
      form.setValue("type", value as keyof typeof typeConfig)
    },
    [form],
  )

  function onSubmit(values: z.infer<typeof formSchema>) {
    mutation.mutate(values)
  }

  return (
    <div className="flex min-h-[400px] w-[600px] flex-col">
      <div className="mb-6">
        <p className="text-sm text-text-secondary">{t("discover.find_feeds_description")}</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Type Selector */}
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem className="relative">
                <FormControl>
                  <SegmentGroup value={field.value} onValueChanged={handleTypeChange}>
                    <SegmentItem value="rss" label={t("words.rss")} />
                    <SegmentItem value="rsshub" label={t("words.rsshub")} />
                  </SegmentGroup>
                </FormControl>
                <p className="absolute right-0 bottom-0 text-right text-sm leading-6 text-text-secondary">
                  <Trans
                    i18nKey="discover.go_to_discover_hint"
                    components={{
                      Link: (
                        <Link className="text-accent underline" to="/discover" onClick={dismiss} />
                      ),
                      Icon: <i className="i-mgc-arrow-right-up-cute-re" />,
                      br: <br />,
                    }}
                  />
                </p>
              </FormItem>
            )}
          />

          {/* Input Field */}
          <FormField
            control={form.control}
            name="keyword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t(currentConfig.label)}</FormLabel>
                <FormControl>
                  <Input placeholder={currentConfig.placeholder} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={dismiss}>
              {t("words.cancel", { ns: "common" })}
            </Button>
            <Button type="submit" isLoading={mutation.isPending}>
              {t("discover.preview")}
            </Button>
          </div>
        </form>
      </Form>

      {/* Search Results */}
      {discoverSearchData && discoverSearchData.length > 0 && (
        <div className="mt-6 flex-1">
          <div className="mb-4 border-b border-border pb-2">
            <h3 className="font-medium text-text">
              {t("discover.search_results")} ({discoverSearchData.length})
            </h3>
          </div>
          <div className="max-h-[300px] space-y-3 overflow-y-auto">
            {discoverSearchData.map((item, index) => (
              <DiscoverFeedCard key={index} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
