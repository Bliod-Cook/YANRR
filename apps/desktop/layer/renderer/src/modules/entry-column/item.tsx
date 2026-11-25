import { FeedViewType } from "@follow/constants"
import { useHasEntry } from "@follow/store/entry/hooks"
import { useEntryTranslation, usePrefetchEntryTranslation } from "@follow/store/translation/hooks"
import type { FC } from "react"
import { memo } from "react"

import { useShowAITranslationAuto } from "~/atoms/ai-translation"
import { useServerCapability } from "~/atoms/server-configs"
import { useActionLanguage, useGeneralSettingKey } from "~/atoms/settings/general"

import { getItemComponentByView } from "./Items/getItemComponentByView"
import { EntryItemWrapper } from "./layouts/EntryItemWrapper"
import type { EntryListItemFC } from "./types"

interface EntryItemProps {
  entryId: string
  view: FeedViewType
  currentFeedTitle?: string
  isFirstItem?: boolean
}
const EntryItemImpl = memo(function EntryItemImpl({
  entryId,
  view,
  currentFeedTitle,
  isFirstItem,
}: EntryItemProps) {
  const aiEnabled = useServerCapability("ai")
  const enableTranslation = useShowAITranslationAuto()
  const translationMode = useGeneralSettingKey("translationMode")
  const actionLanguage = useActionLanguage()
  const translation = useEntryTranslation({
    entryId,
    language: actionLanguage,
    mode: translationMode,
    enabled: enableTranslation,
  })
  usePrefetchEntryTranslation({
    // An action rule may ask for translations the server cannot make
    entryIds: aiEnabled ? [entryId] : [],
    enabled: enableTranslation,
    language: actionLanguage,
    withContent: view === FeedViewType.SocialMedia,
    mode: translationMode,
  })

  const Item: EntryListItemFC = getItemComponentByView(view)

  return (
    <EntryItemWrapper
      itemClassName={Item.wrapperClassName}
      entryId={entryId}
      view={view}
      isFirstItem={isFirstItem}
    >
      <Item entryId={entryId} translation={translation} currentFeedTitle={currentFeedTitle} />
    </EntryItemWrapper>
  )
})

export const EntryItem: FC<EntryItemProps> = memo(({ entryId, view, currentFeedTitle }) => {
  const hasEntry = useHasEntry(entryId)

  if (!hasEntry) return null
  return <EntryItemImpl entryId={entryId} view={view} currentFeedTitle={currentFeedTitle} />
})

export const EntryVirtualListItem = ({
  ref,
  entryId,
  view,
  className,
  currentFeedTitle,
  ...props
}: EntryItemProps &
  React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    ref?: React.Ref<HTMLDivElement | null>
  }) => {
  const hasEntry = useHasEntry(entryId)

  if (!hasEntry) return <div ref={ref} {...props} style={undefined} />

  const isFirstItem = props["data-index"] === 0

  return (
    <div className="absolute top-0 left-0 w-full will-change-transform" ref={ref} {...props}>
      <EntryItemImpl
        entryId={entryId}
        view={view}
        currentFeedTitle={currentFeedTitle}
        isFirstItem={isFirstItem}
      />
    </div>
  )
}
