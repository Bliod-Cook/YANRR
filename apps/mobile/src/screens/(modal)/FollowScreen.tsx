import type { NavigationControllerView } from "@/src/lib/navigation/types"
import { FollowFeed, FollowUrl } from "@/src/modules/feed/FollowFeed"
import { parseLinkView } from "@/src/modules/feed/link-view"

export const FollowScreen: NavigationControllerView<{
  id?: string
  type: "feed" | "url"
  url?: string
  /** The view a link asks for. */
  view?: string
}> = ({ id, type, url, view }) => {
  const defaultView = parseLinkView(view)
  // Keyed, so a form that another link replaces starts over rather than keeping what was typed
  switch (type) {
    case "feed": {
      return <FollowFeed key={id} id={id as string} defaultView={defaultView} />
    }
    case "url": {
      return <FollowUrl key={url} url={url as string} defaultView={defaultView} />
    }
    default: {
      return <FollowFeed key={id} id={id as string} defaultView={defaultView} />
    }
  }
}
