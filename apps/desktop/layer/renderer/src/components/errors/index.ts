import EntryNotFound from "./EntryNotFound"
import { ErrorComponentType } from "./enum"
import FeedNotFound from "./FeedNotFound"
import ModalError from "./ModalError"
import PageError from "./PageError"
import RSSHubError from "./RSSHubError"

const ErrorFallbackMap = {
  [ErrorComponentType.Modal]: ModalError,
  [ErrorComponentType.Page]: PageError,
  [ErrorComponentType.FeedNotFound]: FeedNotFound,
  [ErrorComponentType.RSSHubDiscoverError]: RSSHubError,
  [ErrorComponentType.EntryNotFound]: EntryNotFound,
}

export const getErrorFallback = (type: ErrorComponentType) => ErrorFallbackMap[type]
