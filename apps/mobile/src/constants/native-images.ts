import { BlackBoard2FillIcon } from "../icons/black_board_2_fill"
import { BlackBoard2LineIcon } from "../icons/black_board_2_line"
import { Home5FillIcon } from "../icons/home_5_fill"
import { Home5LineIcon } from "../icons/home_5_line"
import { Search3FillIcon } from "../icons/search_3_fill"
import { Search3LineIcon } from "../icons/search_3_line"
import { Settings1FillIcon } from "../icons/settings_1_fill"
import { Settings1LineIcon } from "../icons/settings_1_line"

export const IconNodeMap = {
  home5Line: Home5LineIcon,
  home5Fill: Home5FillIcon,
  settings1Line: Settings1LineIcon,
  settings1Fill: Settings1FillIcon,
  blackBoard2Line: BlackBoard2LineIcon,
  blackBoard2Fill: BlackBoard2FillIcon,
  search3Line: Search3LineIcon,
  search3Fill: Search3FillIcon,
} as const

export const IconNativeNameMap = {
  home5Line: "home_5_line",
  home5Fill: "home_5_fill",
  settings1Line: "settings_1_line",
  settings1Fill: "settings_1_fill",
  blackBoard2Line: "black_board_2_line",
  blackBoard2Fill: "black_board_2_fill",
  search3Line: "search_3_line",
  search3Fill: "search_3_fill",
} as const

export type IconNativeName = keyof typeof IconNativeNameMap

export type IconNativeValues = (typeof IconNativeNameMap)[keyof typeof IconNativeNameMap]
