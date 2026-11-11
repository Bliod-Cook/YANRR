import type {
  DeleteMessagingTokenResponse,
  EntryGetByIdResponse as SdkEntryGetByIdResponse,
  EntryGetQuery,
  EntryListRequest as SdkEntryListRequest,
  EntryWithFeed as SdkEntryWithFeed,
  ExtractResponseData,
  FeedViewType,
  FollowClient,
  InboxListEntry,
  InboxListEntryRequestInput,
  ModuleAPIs,
  StructuredSuccessResponse,
} from "@follow-app/client-sdk"

// The client SDK types Folo's server. Where this server's API differs, its contract is typed here,
// and `FollowAPI` gives those routes these types instead of the SDK's.

/** Where a search found its terms in an entry: texts cut into pieces, every other one from the second a term */
export interface EntryHighlight {
  title: string[]
  /** Where the description or content has a term the title lacks */
  snippet: string[] | null
}

/** `POST /entries` */
export type EntryListRequest = SdkEntryListRequest & {
  /** The entry at the cursor, which places it among the entries of its time */
  cursorId?: string
  /** Searches the timeline for these words, or every entry the user may read when it names none */
  keyword?: string
  /** The timeline of this inbox */
  inboxId?: string
}

/** An item of `POST /entries` */
export type EntryWithFeed = Omit<SdkEntryWithFeed, "collections"> & {
  /** Set when the user collected the entry: when, and from which view */
  collections?: NonNullable<SdkEntryWithFeed["collections"]> & { view?: FeedViewType }
  /** With a `keyword`, where its terms are */
  highlight?: EntryHighlight
}

/** `POST /entries/inbox` */
export type InboxListEntryRequest = InboxListEntryRequestInput & {
  /** The entry at the cursor, which places it among the entries of its time */
  cursorId?: string
}

/** The entry `GET /entries?id=` answers, with whether the user read it */
export type EntryGetByIdData = NonNullable<ExtractResponseData<SdkEntryGetByIdResponse>> & {
  read?: boolean
}

/** `GET /status/configs`, which needs no session: what the server offers */
export interface ServerConfigs {
  /** Entry summaries and translation are configured (AI chat is another feature) */
  ai: boolean
  /** Sign-up is accepted */
  registration: boolean
  /** Push notifications are configured */
  push: boolean
}

/** `DELETE /messaging`: removes this push token only */
export interface DeleteMessagingTokenRequest {
  token: string
}

/** `POST /subscriptions/import`, which answers the SDK's `SubscriptionImportResponse` */
export interface SubscriptionImportRequest {
  items: { url: string; title?: string; category?: string }[]
  view?: FeedViewType
}

type FetchOptions = Parameters<ModuleAPIs["entries"]["list"]>[1]
type Route<Input, Response> = (args: Input, options?: FetchOptions) => Promise<Response>
type Override<T, U> = Omit<T, keyof U> & U

/** The routes of `FollowClient.api`, typed by this server's contract */
export type FollowAPI = Override<
  ModuleAPIs,
  {
    entries: Override<
      ModuleAPIs["entries"],
      {
        get: Route<EntryGetQuery, StructuredSuccessResponse<EntryGetByIdData | null>>
        list: Route<EntryListRequest, StructuredSuccessResponse<EntryWithFeed[]>>
        inbox: Override<
          ModuleAPIs["entries"]["inbox"],
          { list: Route<InboxListEntryRequest, StructuredSuccessResponse<InboxListEntry[]>> }
        >
      }
    >
    messaging: Override<
      ModuleAPIs["messaging"],
      { deleteToken: Route<DeleteMessagingTokenRequest, DeleteMessagingTokenResponse> }
    >
    status: Override<
      ModuleAPIs["status"],
      {
        getConfigs: (
          args?: never,
          options?: FetchOptions,
        ) => Promise<StructuredSuccessResponse<ServerConfigs>>
      }
    >
  }
>

/** The client's routes, with the types of this server's contract */
export const followAPIOf = (client: FollowClient) =>
  // The routes are the same; only the SDK's types describe Folo's answers
  client.api as unknown as FollowAPI
