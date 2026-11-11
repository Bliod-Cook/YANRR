import type { EntryModel } from "@follow/store/entry/types"

/**
 * How many rows each day of the list has, in order. Every id is a row: one that is not in the
 * store, or an onboarding entry, joins the day before it, so the counts add up to the list length.
 */
export const countEntriesByDate = (
  entryIds: readonly string[],
  entries: Record<string, EntryModel | undefined>,
) => {
  const counts: number[] = []
  let lastDate = ""
  for (const id of entryIds) {
    const entry = entries[id]
    const date = entry ? new Date(entry.publishedAt).toDateString() : null
    if (date !== null && date !== lastDate) {
      counts.push(1)
      lastDate = date
    } else if (counts.length === 0) {
      counts.push(1)
    } else {
      const lastIndex = counts.length - 1
      counts[lastIndex] = counts[lastIndex]! + 1
    }
  }
  return counts
}
