import { useRouteParamsSelector } from "~/hooks/biz/useRouteParams"

import { getOpenEntryId } from "../store/route-context"

/** The entry open in the timeline, which the chat is about */
export const useMainEntryId = (): string | undefined => useRouteParamsSelector(getOpenEntryId)
