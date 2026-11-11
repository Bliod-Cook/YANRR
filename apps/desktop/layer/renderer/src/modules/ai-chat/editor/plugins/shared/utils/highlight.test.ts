import { describe, expect, it } from "vitest"

import { splitByQuery } from "./highlight"

describe("splitByQuery", () => {
  it("takes regular expression characters in the query literally", () => {
    expect(splitByQuery("C++ (draft) [x]", "c++")).toEqual([
      { text: "C++", isMatch: true },
      { text: " (draft) [x]", isMatch: false },
    ])
    expect(splitByQuery("a (b) (c", "(")).toEqual([
      { text: "a ", isMatch: false },
      { text: "(", isMatch: true },
      { text: "b) ", isMatch: false },
      { text: "(", isMatch: true },
      { text: "c", isMatch: false },
    ])
  })

  it("leaves the text whole without a query or a match", () => {
    expect(splitByQuery("Feed", "")).toEqual([{ text: "Feed", isMatch: false }])
    expect(splitByQuery("Feed", ".*")).toEqual([{ text: "Feed", isMatch: false }])
  })
})
