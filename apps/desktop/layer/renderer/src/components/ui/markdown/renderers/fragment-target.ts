// The client's HTML sanitizer prefixes ids to keep them from clobbering the app's own, while
// links in the content still point at the original ids.
const SANITIZER_ID_PREFIX = "user-content-"

const stripSanitizerPrefix = (id: string) =>
  id.startsWith(SANITIZER_ID_PREFIX) ? id.slice(SANITIZER_ID_PREFIX.length) : id

const decodeFragment = (fragment: string) => {
  try {
    return decodeURIComponent(fragment)
  } catch {
    return fragment
  }
}

export const isFragmentLink = (href: string | undefined): href is `#${string}` =>
  !!href?.startsWith("#")

/** The element in rendered content that an in-page link like `#section-2` points at */
export const findFragmentTarget = (container: ParentNode, href: string): HTMLElement | null => {
  const wanted = stripSanitizerPrefix(decodeFragment(href.slice(1)))
  if (!wanted) return null

  for (const element of container.querySelectorAll<HTMLElement>("[id]")) {
    if (stripSanitizerPrefix(element.id) === wanted) return element
  }
  return null
}
