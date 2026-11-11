import type { PrimitiveAtom } from "jotai"
import { atom } from "jotai"
import { createContext, use, useState } from "react"

interface SearchPageContextType {
  searchFocusedAtom: PrimitiveAtom<boolean>
  searchValueAtom: PrimitiveAtom<string>
}
export const SearchPageContext = createContext<SearchPageContextType>(null!)

export const SearchPageProvider = ({ children }: { children: React.ReactNode }) => {
  const [atomRefs] = useState((): SearchPageContextType => {
    const searchFocusedAtom = atom(false)
    const searchValueAtom = atom("")
    return {
      searchFocusedAtom,
      searchValueAtom,
    }
  })
  return <SearchPageContext value={atomRefs}>{children}</SearchPageContext>
}

export const useSearchPageContext = () => {
  const ctx = use(SearchPageContext)
  if (!ctx) throw new Error("useDiscoverPageContext must be used within a DiscoverPageProvider")
  return ctx
}
