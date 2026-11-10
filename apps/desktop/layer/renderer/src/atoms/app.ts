import { WindowState } from "@follow/shared/bridge"
import { atom } from "jotai"

import { createAtomHooks } from "~/lib/jotai"
import type { SearchScope } from "~/modules/panel/search-scope"

export const [, , useAppIsReady, , appIsReady, setAppIsReady] = createAtomHooks(atom(false))
export const [, , useAppMessagingToken, , appMessagingToken, setAppMessagingToken] =
  createAtomHooks(atom<string | null>(null))

export const [, , useAppSearchOpen, , , setAppSearchOpen] = createAtomHooks(atom(false))
/** The timeline quick search is narrowed to, if any */
export const [, useAppSearchScope, , , , setAppSearchScope] = createAtomHooks(
  atom<SearchScope | null>(null),
)

// For electron
export const [, , useWindowState, , windowState, setWindowState] = createAtomHooks(
  atom<WindowState>(WindowState.NORMAL),
)
