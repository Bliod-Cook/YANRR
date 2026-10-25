import { icons } from "@iconify-json/mingcute"
import { expect, it } from "vitest"

import { findBarPage } from "./find-bar-page"

it("draws its buttons with open-source MingCute icons", () => {
  for (const name of ["back-2-line", "forward-2-line", "close-line"]) {
    expect(findBarPage).toContain(icons.icons[name]!.body)
  }
})
