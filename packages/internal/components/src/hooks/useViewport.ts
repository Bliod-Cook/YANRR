import type { ExtractAtomValue, getDefaultStore } from "jotai"
import { useAtomValue } from "jotai"
import { selectAtom } from "jotai/utils"
import { useMemo } from "react"
import { shallow } from "zustand/shallow"

import { viewportAtom } from "../atoms/viewport"

/**
 * Prefer a selector with a stable identity (module-level or `useCallback`): a new selector
 * derives a new atom.
 */
export const useViewport = <T>(selector: (value: ExtractAtomValue<typeof viewportAtom>) => T): T =>
  useAtomValue(useMemo(() => selectAtom(viewportAtom, selector, shallow), [selector]))

type JotaiStore = ReturnType<typeof getDefaultStore>
export const getViewport = (store: JotaiStore) => store.get(viewportAtom)
