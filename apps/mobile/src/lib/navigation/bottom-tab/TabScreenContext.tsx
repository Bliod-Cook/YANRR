import { createContext } from "react"

export interface TabScreenContextType {
  tabScreenIndex: number
}
export const TabScreenContext = createContext<TabScreenContextType>(null!)
