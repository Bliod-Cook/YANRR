export interface LayoutVersion {
  entryIds: readonly string[]
  version: number
}

/**
 * Counts the changes of a list that move the entries on screen: entries coming in at its head,
 * removed or reordered. Appending a page leaves them where they are, and the version as it is.
 */
export const nextLayoutVersion = (
  previous: LayoutVersion,
  entryIds: readonly string[],
): LayoutVersion => {
  if (previous.entryIds === entryIds) return previous
  // Every entry still where it was, with those after them appended
  const kept = previous.entryIds.every((id, index) => entryIds[index] === id)
  // The same list, in a new array: kept as it was, so a render that takes it changes nothing
  if (kept && entryIds.length === previous.entryIds.length) return previous
  return { entryIds, version: kept ? previous.version : previous.version + 1 }
}
