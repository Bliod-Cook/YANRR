import { createContext } from "react"

export interface EntryInfoContext {
  feedId: string
  entryId: string
}
const defaultInfoContextValue: EntryInfoContext = {
  feedId: "",
  entryId: "",
}
export const EntryInfoContext = createContext<EntryInfoContext>(defaultInfoContextValue)
