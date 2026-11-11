export interface HighlightSegment {
  text: string
  isMatch: boolean
}

/** Splits `text` around the case-insensitive occurrences of `query`, which is taken literally */
export const splitByQuery = (text: string, query: string): HighlightSegment[] => {
  const needle = query.toLowerCase()
  const haystack = text.toLowerCase()
  // Lowercasing changes the length of a few characters, whose offsets would then not match
  if (!needle || haystack.length !== text.length) return [{ text, isMatch: false }]

  const segments: HighlightSegment[] = []
  let start = 0
  for (
    let index = haystack.indexOf(needle);
    index !== -1;
    index = haystack.indexOf(needle, start)
  ) {
    if (index > start) segments.push({ text: text.slice(start, index), isMatch: false })
    segments.push({ text: text.slice(index, index + needle.length), isMatch: true })
    start = index + needle.length
  }
  if (start < text.length) segments.push({ text: text.slice(start), isMatch: false })
  return segments
}
