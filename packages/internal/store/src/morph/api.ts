import type { FeedSchema, InboxSchema } from "@follow/database/schemas/types"
import { getDateISOString } from "@follow/utils/utils"
import type {
  AuthUser,
  EntryGetByIdResponse,
  EntryListResponse,
  EntryWithFeed,
  ExtractResponseData,
  InboxEntryGetResponse,
  InboxListEntry,
  InboxListEntryResponse,
  InboxSubscriptionResponse,
  ListSubscriptionResponse,
  SubscriptionWithFeed,
} from "@follow-app/client-sdk"

import type { RemoteCollectionModel } from "../modules/collection/types"
import type { EntryModel } from "../modules/entry/types"
import type { FeedModel } from "../modules/feed/types"
import type { SubscriptionModel } from "../modules/subscription/types"
import type { MeModel } from "../modules/user/store"

// The client SDK does not type these fields of the server's answers yet
/** The collection of a timeline item */
type TimelineCollection = { createdAt: Date; view?: RemoteCollectionModel["view"] }
/** A single entry, with whether the user read it where the server tells */
type SingleEntry = NonNullable<InboxEntryGetResponse["data"] | EntryGetByIdResponse["data"]> & {
  read?: boolean
}

class APIMorph {
  /** The entry the server sent, with the read state of `current` where it sent none */
  toEntry(data: SingleEntry | null | undefined, current?: EntryModel): EntryModel | null {
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
      read: data.read ?? current?.read ?? false,
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

  toCollections(data: ExtractResponseData<InboxListEntryResponse | EntryListResponse>): {
    collections: RemoteCollectionModel[]
    entryIdsNotInCollections: string[]
  } {
    if (!data) return { collections: [], entryIdsNotInCollections: [] }

    const collections: RemoteCollectionModel[] = []
    const entryIdsNotInCollections: string[] = []
    for (const item of data) {
      if (!("collections" in item)) {
        entryIdsNotInCollections.push((item as EntryWithFeed).entries.id)
        continue
      }
      const collection: TimelineCollection | undefined = item.collections
      if (collection)
        collections.push({
          createdAt: getDateISOString(collection.createdAt),
          entryId: item.entries.id,
          feedId: item.feeds.id,
          view: collection.view,
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
      image: data.image,
      // The auth client parses the dates of its answers; the store keeps them as ISO strings
      createdAt: new Date(data.createdAt).toISOString(),
      updatedAt: new Date(data.updatedAt).toISOString(),
      isAnonymous: data.isAnonymous,
      suspended: data.suspended,
      deleted: data.deleted,
      inactive: data.inactive,
    }
  }
}
export const apiMorph = new APIMorph()
