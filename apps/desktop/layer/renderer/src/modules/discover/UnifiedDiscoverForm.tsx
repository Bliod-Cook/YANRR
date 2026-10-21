import { Button, MotionButtonBase } from "@follow/components/ui/button/index.js"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@follow/components/ui/form/index.jsx"
import { Input } from "@follow/components/ui/input/index.js"
import { cn } from "@follow/utils/utils"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import i18next from "i18next"
import type { ChangeEvent, CompositionEvent } from "react"
import { startTransition, useCallback, useEffect, useMemo, useRef } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router"
import { z } from "zod"

import { useModalStack } from "~/components/ui/modal/stacked/hooks"
import { useRequireLogin } from "~/hooks/common/useRequireLogin"
import { followClient } from "~/lib/api-client"
import { createErrorToaster } from "~/lib/error-parser"

import { setDiscoverSearchData, useDiscoverSearchData } from "./atoms/discover"
import { DiscoverFeedCard } from "./DiscoverFeedCard"
import { DiscoverImport } from "./DiscoverImport"
import { DiscoverInboxList } from "./DiscoverInboxList"
import { DiscoverTransform } from "./DiscoverTransform"
import { FeedForm } from "./FeedForm"
import { isDiscoveredFeedItself } from "./utils"

const isFeedLikeUrl = (value: string) => /^(?:https?:\/\/|rsshub:\/\/|yanrr:\/\/)/.test(value)

const isWebUrl = (value: string) => /^https?:\/\//.test(value)

const isRSSHubRoute = (value: string) => value.startsWith("rsshub://")

const rsshubRouteSchema = z.string().url().startsWith("rsshub://")

const discoverSchema = z.object({
  url: z
    .string()
    .trim()
    // Messages are resolved at validation time so they follow the current language
    .refine(isFeedLikeUrl, {
      error: () => i18next.t("validation.invalid_url", { ns: "common" }),
    })
    .refine((url) => !isRSSHubRoute(url) || rsshubRouteSchema.safeParse(url).success, {
      error: () => i18next.t("discover.invalid_rsshub_route"),
    }),
})

type DiscoverFormData = z.infer<typeof discoverSchema>

// Compact Tool Link Component
interface ToolLinkProps {
  icon: string
  label: string
  onClick: () => void
}

function ToolLink({ icon, label, onClick }: ToolLinkProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors",
        "text-text-secondary hover:bg-fill-secondary hover:text-text",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1",
      )}
    >
      <i className={cn(icon, "size-3.5 shrink-0")} />
      <span>{label}</span>
    </button>
  )
}

export function UnifiedDiscoverForm() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlFromSearch = searchParams.get("url") || ""
  const { t } = useTranslation()
  const { ensureLogin } = useRequireLogin()
  const { present, dismissAll } = useModalStack()

  const isRSSHub = useMemo(() => isRSSHubRoute(urlFromSearch.trim()), [urlFromSearch])

  const form = useForm<DiscoverFormData>({
    resolver: zodResolver(discoverSchema),
    defaultValues: {
      url: urlFromSearch,
    },
    // Not on blur: leaving the autofocused empty box would show an error before any typing, and
    // the message pushes down the tool links under the mouse, so the click that blurred it missed
    mode: "onChange",
  })

  const { trigger } = form
  const atomKey = useRef(urlFromSearch)

  // Validate default value from search params
  useEffect(() => {
    if (!urlFromSearch) {
      return
    }
    trigger("url")
  }, [trigger, urlFromSearch])

  const discoverSearchData = useDiscoverSearchData()?.[atomKey.current] || []

  const mutation = useMutation({
    mutationFn: async (url: string) => {
      const { data } = await followClient.api.discover.discover({ keyword: url })
      return data
    },
    onError: createErrorToaster(t("discover.search_failed")),
  })

  const setUrlSearchParam = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          if (value.trim()) {
            newParams.set("url", value.trim())
          } else {
            newParams.delete("url")
          }
          return newParams
        },
        {
          replace: true,
        },
      )
    },
    [setSearchParams],
  )

  const handleUrlChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.currentTarget
      // During composition, update raw value without validation
      if ((event.nativeEvent as InputEvent)?.isComposing) {
        form.setValue("url", value, { shouldValidate: false })
        return
      }

      startTransition(() => {
        form.setValue("url", value, { shouldValidate: true })
        setUrlSearchParam(value)
      })
    },
    [form, setUrlSearchParam],
  )

  const handleCompositionEnd = useCallback(
    (event: CompositionEvent<HTMLInputElement>) => {
      const { value } = event.currentTarget
      form.setValue("url", value, { shouldValidate: true })
      setUrlSearchParam(value)
    },
    [form, setUrlSearchParam],
  )

  function onSubmit({ url }: DiscoverFormData) {
    if (!ensureLogin()) {
      return
    }

    const presentFeedForm = () =>
      present({
        title: t("feed_form.add_feed"),
        content: () => <FeedForm url={url} onSuccess={dismissAll} />,
      })

    // RSSHub routes and app links open the feed preview directly
    if (!isWebUrl(url)) {
      presentFeedForm()
      return
    }

    // A web address may be a site rather than a feed, so it goes through discovery,
    // which finds the site's feeds; a feed address still opens its preview directly
    mutation.mutate(url, {
      onSuccess: (data) => {
        if (isDiscoveredFeedItself(data, url)) {
          presentFeedForm()
          return
        }
        atomKey.current = url
        setDiscoverSearchData((prev) => ({ ...prev, [url]: data }))
      },
    })
  }

  return (
    <>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="w-full max-w-2xl"
          data-testid="discover-form"
        >
          <div className="rounded-2xl border border-fill-secondary bg-background/70 p-4 shadow-sm">
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem className="mb-4">
                  <FormLabel className="mb-2 text-headline font-bold text-text">
                    {t("discover.url_label")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      autoFocus
                      data-testid="discover-form-input"
                      {...field}
                      value={field.value || ""}
                      onChange={handleUrlChange}
                      onCompositionEnd={handleCompositionEnd}
                      placeholder={t("discover.search_input_placeholder")}
                      className="h-12 text-base"
                    />
                  </FormControl>
                  <FormMessage />
                  {isRSSHub && (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-text-tertiary">
                      <a
                        href="https://docs.rsshub.app/"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-accent px-2 py-px text-accent hover:bg-accent/10"
                      >
                        <i className="i-mgc-book-6-cute-re" />
                        <span>{t("discover.rsshub_docs")}</span>
                      </a>
                    </div>
                  )}
                </FormItem>
              )}
            />
            <div className="center flex flex-col gap-3" data-testid="discover-form-actions">
              <Button
                data-testid="discover-form-submit"
                disabled={!form.formState.isValid}
                type="submit"
                isLoading={mutation.isPending}
              >
                {t("discover.preview")}
              </Button>

              {/* Compact Tools */}
              <div className="mt-5 flex items-center justify-center gap-3 text-xs">
                <ToolLink
                  icon="i-mgc-file-upload-cute-re"
                  label={t("discover.tools.import")}
                  onClick={() => {
                    present({
                      title: t("discover.tools.import"),
                      content: () => <DiscoverImport />,
                      modalClassName: "max-w-2xl w-full",
                    })
                  }}
                />
                <ToolLink
                  icon="i-mgc-web-cute-re"
                  label={t("discover.tools.transform")}
                  onClick={() => {
                    present({
                      title: t("discover.tools.transform"),
                      content: () => <DiscoverTransform />,
                      modalClassName: "max-w-2xl w-full",
                    })
                  }}
                />
                <ToolLink
                  icon="i-mgc-inbox-cute-re"
                  label={t("discover.tools.inbox")}
                  onClick={() => {
                    present({
                      title: t("words.inbox"),
                      content: () => <DiscoverInboxList />,
                      modalClassName: "max-w-2xl w-full",
                    })
                  }}
                />
              </div>
            </div>
          </div>
        </form>
      </Form>

      {discoverSearchData.length > 0 && (
        <div className="mt-8 w-full max-w-2xl">
          <div className="mb-4 flex items-center gap-2 text-sm text-text-secondary">
            {t("discover.search.results", { count: discoverSearchData.length })}
            <MotionButtonBase
              className="flex cursor-button items-center justify-between gap-2 hover:text-accent"
              type="button"
              aria-label={t("discover.search.clear_results")}
              onClick={() => {
                setDiscoverSearchData({})
                mutation.reset()
              }}
            >
              <i className="i-mgc-close-cute-re" />
            </MotionButtonBase>
          </div>
          <div className="space-y-4 text-sm">
            {discoverSearchData.map((item) => (
              <DiscoverFeedCard key={item.feed?.id} item={item} className="last:border-b-0" />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
