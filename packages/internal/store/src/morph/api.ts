import type { FeedSchema, InboxSchema } from "@follow/database/schemas/types"
import { getDateISOString } from "@follow/utils/utils"
import type {
  AddFeedsResponse,
  AuthUser,
  EntryGetByIdResponse,
  EntryListResponse,
  EntryWithFeed,
  ExtractResponseData,
  FeedViewType,
  InboxEntryGetResponse,
  InboxListEntry,
  InboxListEntryResponse,
  InboxSubscriptionResponse,
  ListSubscriptionResponse,
  SubscriptionWithFeed,
} from "@follow-app/client-sdk"

import type { CollectionModel } from "../modules/collection/types"
import type { EntryModel } from "../modules/entry/types"
import type { FeedModel } from "../modules/feed/types"
import type { SubscriptionModel } from "../modules/subscription/types"
import type { MeModel } from "../modules/user/store"

class APIMorph {
  toEntry(data?: InboxEntryGetResponse["data"] | EntryGetByIdResponse["data"]): EntryModel | null {
    if (!data) return null

    return {
      id: data.entries.id,
      title: data.entries.title,
      url: data.entries.url,
      content: data.entries.content,
      readabilityContent: null,
      description: data.entries.description,
      guid: data.entries.guid,
      author: data.entries.author,
      authorUrl: data.entries.authorUrl,
      authorAvatar: data.entries.authorAvatar,
      insertedAt: new Date(data.entries.insertedAt),
      publishedAt: new Date(data.entries.publishedAt),
      media: data.entries.media ?? null,
      categories: data.entries.categories ?? null,
      attachments: data.entries.attachments ?? null,
      extra: data.entries.extra
        ? {
            links: data.entries.extra.links ?? undefined,
            title_keyword: data.entries.extra.title_keyword ?? undefined,
          }
        : null,
      language: data.entries.language,
      feedId: data.feeds.id,
      inboxHandle: "feeds" in data ? (data.feeds.type === "inbox" ? data.feeds.id : null) : null,
      read: false,
      sources: null,
      settings: "settings" in data ? data.settings || null : null,
    }
  }
  toSubscription(
    data: (SubscriptionWithFeed | ListSubscriptionResponse | InboxSubscriptionResponse)[],
  ) {
    const subscriptions: SubscriptionModel[] = []

    const collections = {
      feeds: [],
      inboxes: [],
    } as {
      feeds: FeedSchema[]
      inboxes: InboxSchema[]
    }

    for (const item of data) {
      const baseSubscription = {
        category: item.category!,

        userId: item.userId,
        view: item.view,
        hideFromTimeline: item.hideFromTimeline,
        title: item.title,
        createdAt: item.createdAt,
      } as SubscriptionModel

      if ("feeds" in item) {
        baseSubscription.feedId = item.feedId
        baseSubscription.type = "feed"
        const feed = item.feeds
        collections.feeds.push({
          description: feed.description!,
          id: feed.id,
          errorAt: feed.errorAt!,
          errorMessage: feed.errorMessage!,
          image: feed.image!,
          ownerUserId: feed.ownerUserId!,
          siteUrl: feed.siteUrl!,
          title: feed.title!,
          url: feed.url,
        })
      } else if ("inboxes" in item) {
        baseSubscription.inboxId = item.inboxId
        baseSubscription.type = "inbox"
        const inbox = item.inboxes

        collections.inboxes.push({
          id: inbox.id,
          title: inbox.title,
          secret: inbox.secret,
        })
      } else {
        // The server has no lists; the client SDK still types their subscriptions
        continue
      }

      subscriptions.push(baseSubscription)
    }
    return { subscriptions, collections }
  }

  toCollections(
    data: ExtractResponseData<InboxListEntryResponse | EntryListResponse>,
    view: FeedViewType,
  ): {
    collections: CollectionModel[]
    entryIdsNotInCollections: string[]
  } {
    if (!data) return { collections: [], entryIdsNotInCollections: [] }

    const collections: CollectionModel[] = []
    const entryIdsNotInCollections: string[] = []
    for (const item of data) {
      if (!("collections" in item)) {
        entryIdsNotInCollections.push((item as EntryWithFeed).entries.id)
        continue
      }
      if (item.collections)
        collections.push({
          createdAt: getDateISOString(item.collections.createdAt),
          entryId: item.entries.id,
          feedId: item.feeds.id,
          view,
        })
    }

    return {
      collections,
      entryIdsNotInCollections,
    }
  }

  toEntryList(data?: InboxListEntry[] | EntryWithFeed[]): EntryModel[] {
    const entries: EntryModel[] = []
    for (const item of data ?? []) {
      entries.push({
        id: item.entries.id,
        title: item.entries.title,
        url: item.entries.url,
        content: null,
        readabilityContent: null,
        description: item.entries.description,
        guid: item.entries.guid,
        author: item.entries.author,
        authorUrl: item.entries.authorUrl,
        authorAvatar: item.entries.authorAvatar,
        insertedAt: new Date(item.entries.insertedAt),
        publishedAt: new Date(item.entries.publishedAt),
        media: item.entries.media ?? null,
        categories: item.entries.categories ?? null,
        attachments: item.entries.attachments ?? null,
        extra: item.entries.extra
          ? {
              links: item.entries.extra.links ?? undefined,
              title_keyword: item.entries.extra.title_keyword ?? undefined,
            }
          : null,
        language: item.entries.language,
        feedId: item.feeds.id,
        inboxHandle: item.feeds.type === "inbox" ? item.feeds.id : null,
        read: item.read,
        sources: "from" in item && Array.isArray(item.from) ? item.from : null,
        settings: item.settings ?? null,
      })
    }
    return entries
  }

  toFeed(data: EntryWithFeed["feeds"]): FeedModel {
    return {
      type: "feed",
      id: data.id,
      title: data.title,
      url: data.url,
      image: data.image,
      description: data.description,
      ownerUserId: data.ownerUserId,
      errorAt: data.errorAt,
      errorMessage: data.errorMessage,
      siteUrl: data.siteUrl,
    }
  }

  toFeedFromAddFeeds(data: AddFeedsResponse["data"][number]): FeedModel {
    return {
      type: "feed",
      id: data.id,
      title: data.title,
      url: data.url,
      image: data.image,
      description: data.description,
      ownerUserId: data.ownerUserId,
      errorAt: data.errorAt,
      errorMessage: data.errorMessage,
      siteUrl: data.siteUrl,
    }
  }

  toWhoami(data: AuthUser): MeModel {
    return {
      id: data.id,
      name: data.name,
      email: data.email,
      handle: data.handle,
      image: data.image,
      bio: data.bio,
      website: data.website,
      socialLinks: data.socialLinks,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      isAnonymous: data.isAnonymous,
      suspended: data.suspended,
      deleted: data.deleted,
      inactive: data.inactive,
    }
  }
}
export const apiMorph = new APIMorph()
