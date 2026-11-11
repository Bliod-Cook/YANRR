/**
 * The entries the reader scrolled past since the last report of the visible ones: seen before,
 * not visible now, still listed, and before the first entry visible now. Entries are told apart
 * by id rather than by position, as the list moves under them when entries arrive at its head or
 * leave an unread-only list.
 *
 * An entry that left the screen while a later one is still visible stays seen until it is passed:
 * in a masonry layout an entry leaves the top of its column while an earlier, taller one in the
 * other column is still on screen.
 */
export const collectEntriesScrolledPast = ({
  seen,
  visible,
  entryIds,
  pastEnd = false,
}: {
  /** Entries visible at earlier reports and not scrolled past yet */
  seen: ReadonlySet<string>
  visible: readonly string[]
  /** The list as it is now */
  entryIds: readonly string[]
  /** Nothing is visible because the reader scrolled past the last entry */
  pastEnd?: boolean
}): { scrolledPast: string[]; seen: ReadonlySet<string> } => {
  if (visible.length === 0 && !pastEnd) return { scrolledPast: [], seen }

  const indexById = new Map(entryIds.map((id, index) => [id, index]))
  let firstVisibleIndex = entryIds.length
  for (const id of visible) {
    firstVisibleIndex = Math.min(firstVisibleIndex, indexById.get(id) ?? entryIds.length)
  }

  const scrolledPast: string[] = []
  const stillSeen = new Set(visible)
  for (const id of seen) {
    const index = indexById.get(id)
    if (stillSeen.has(id) || index === undefined) continue
    if (index < firstVisibleIndex) {
      scrolledPast.push(id)
    } else {
      stillSeen.add(id)
    }
  }
  return { scrolledPast, seen: stillSeen }
}
