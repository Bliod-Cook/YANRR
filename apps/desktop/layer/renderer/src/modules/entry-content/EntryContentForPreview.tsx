import { useEntry } from "@follow/store/entry/hooks"
import { useIsInbox } from "@follow/store/inbox/hooks"
import { thenable } from "@follow/utils"
import { stopPropagation } from "@follow/utils/dom"
import { clsx } from "@follow/utils/utils"
import { memo } from "react"

import { useEntryIsInReadability } from "~/atoms/readability"
import { ErrorBoundary } from "~/components/common/ErrorBoundary"
import { ShadowDOM } from "~/components/common/ShadowDOM"
import { useEntryView } from "~/hooks/biz/useEntryView"
import { WrappedElementProvider } from "~/providers/wrapped-element-provider"

import { EntryContentFallback } from "./components/entry-content/EntryContentFallback"
import { EntryContentPlaceholder } from "./components/entry-content/EntryContentPlaceholder"
import { EntryNoContent } from "./components/entry-content/EntryNoContent"
import { EntryRenderError } from "./components/entry-content/EntryRenderError"
import type { EntryContentProps } from "./components/entry-content/types"
import { EntryAttachments } from "./components/EntryAttachments"
import { EntryTitle } from "./components/EntryTitle"
import { ArticleRenderer } from "./components/layouts/ArticleLayout"
import { useEntryContent } from "./hooks"

const EntryContentImpl: Component<EntryContentProps> = ({ entryId, noMedia, compact }) => {
  const entry = useEntry(entryId, (state) => {
    const { feedId, inboxHandle, url } = state

    return { feedId, inboxId: inboxHandle, url }
  })
  if (!entry) throw thenable

  const isInbox = useIsInbox(entry?.inboxId)
  const isInReadabilityMode = useEntryIsInReadability(entryId)

  const { error, content, isPending } = useEntryContent(entryId)

  const view = useEntryView(entryId)

  return (
    <div className="relative flex size-full flex-col @container print:size-auto print:overflow-visible">
      <article
        onContextMenu={stopPropagation}
        className={clsx("relative m-auto min-w-0 select-text", "w-full max-w-full")}
      >
        <EntryTitle entryId={entryId} compact={compact} />

        {!content && !isInReadabilityMode && (isPending || error) ? (
          <EntryContentPlaceholder entryId={entryId} error={error} />
        ) : (
          <WrappedElementProvider boundingDetection>
            <div className="mx-auto my-8 max-w-full cursor-auto">
              <ErrorBoundary fallback={EntryRenderError}>
                {content || isInReadabilityMode ? (
                  <ShadowDOM injectHostStyles={!isInbox}>
                    <ArticleRenderer
                      entryId={entryId}
                      view={view}
                      feedId={entry.feedId || ""}
                      noMedia={noMedia}
                      content={content}
                    />
                  </ShadowDOM>
                ) : (
                  <EntryNoContent id={entryId} url={entry.url} view={view} />
                )}
              </ErrorBoundary>
            </div>
          </WrappedElementProvider>
        )}

        <EntryAttachments entryId={entryId} />
      </article>
    </div>
  )
}
export const EntryContentForPreview: Component<EntryContentProps> = memo((props) => {
  return (
    <EntryContentFallback entryId={props.entryId}>
      <EntryContentImpl {...props} />
    </EntryContentFallback>
  )
})
