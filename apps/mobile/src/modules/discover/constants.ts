import type { RSSHubCategories } from "@follow/constants"

export type Language = "all" | "eng" | "cmn" | "fra"
export type DiscoverCategories = (typeof RSSHubCategories)[number] | string
