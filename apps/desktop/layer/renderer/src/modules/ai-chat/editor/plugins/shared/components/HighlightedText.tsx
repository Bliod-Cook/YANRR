import type { FC } from "react"

import { splitByQuery } from "../utils/highlight"

/** `text` with the occurrences of `query` emphasized */
export const HighlightedText: FC<{ text: string; query: string }> = ({ text, query }) =>
  splitByQuery(text, query).map((segment, index) => (
    <span
      // The segments of one text never reorder
      key={index}
      className={segment.isMatch ? "font-semibold text-text-vibrant" : undefined}
    >
      {segment.text}
    </span>
  ))
