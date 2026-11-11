import type { SpotlightRule } from "@follow/shared/spotlight"

export interface MediaModel {
  url: string
  type: "photo" | "video"
  preview_image_url?: string
  width?: number
  height?: number
  blurhash?: string
}

export interface AttachmentModel {
  url: string
  mime_type?: string
}

export interface EntryModel {
  content?: string
  url?: string | null
  media?: MediaModel[]
  attachments?: AttachmentModel[] | null
  spotlightRules?: SpotlightRule[]
}

export interface SpotlightState {
  spotlights: SpotlightRule[]
}
