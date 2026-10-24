import type { ViewDefinition as ViewDefinitionBase } from "@follow/constants"
import { FeedViewType, getViewList } from "@follow/constants"
import type { FC } from "react"

import { AnnouncementFillIcon } from "../icons/announcement_fill"
import { BubbleFillIcon } from "../icons/bubble_fill"
import { MicFillIcon } from "../icons/mic_fill"
import { PaperFillIcon } from "../icons/paper_fill"
import { PicFillIcon } from "../icons/pic_fill"
import { ThoughtFillIcon } from "../icons/thought_fill"
import { VideoFillIcon } from "../icons/video_fill"

interface ViewDefinitionExtended {
  icon: FC<{ color?: string; height?: number; width?: number }>
}

const extendMap: Record<FeedViewType, ViewDefinitionExtended> = {
  [FeedViewType.All]: {
    icon: BubbleFillIcon,
  },
  [FeedViewType.Articles]: {
    icon: PaperFillIcon,
  },
  [FeedViewType.SocialMedia]: {
    icon: ThoughtFillIcon,
  },
  [FeedViewType.Pictures]: {
    icon: PicFillIcon,
  },
  [FeedViewType.Videos]: {
    icon: VideoFillIcon,
  },
  [FeedViewType.Audios]: {
    icon: MicFillIcon,
  },
  [FeedViewType.Notifications]: {
    icon: AnnouncementFillIcon,
  },
}

export interface ViewDefinition extends Omit<ViewDefinitionBase, "icon">, ViewDefinitionExtended {}

export const views: ViewDefinition[] = getViewList().map((view) => {
  const extendedView = extendMap[view.view]!
  const { icon: _icon, ...restView } = view
  return {
    ...restView,
    ...extendedView,
  } as ViewDefinition
})
