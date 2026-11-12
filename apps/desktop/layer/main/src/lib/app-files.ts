import { pathToFileURL } from "node:url"

import { net } from "electron"
import path from "pathe"

import { APP_ORIGIN } from "./app-url"

const notFound = () => new Response("Not found", { status: 404 })

/** The file under `root` that `url` names, if it is of the app's origin and stays under `root` */
const resolveAppFile = (url: string, root: string) => {
  // Node gives the URLs of the app protocol no origin
  const { protocol, host, pathname } = new URL(url)
  if (`${protocol}//${host}` !== APP_ORIGIN) return null

  let relativePath: string
  try {
    relativePath = decodeURIComponent(pathname)
  } catch {
    return null
  }
  // Decoded, `%2F` and `%5C` are separators too; the join normalizes them along with `..`
  const filePath = path.join(root, relativePath)
  const fromRoot = path.relative(root, filePath)
  if (fromRoot === ".." || fromRoot.startsWith("../") || path.isAbsolute(fromRoot)) return null
  return filePath
}

/**
 * The answer to a request of the app protocol for one of the app's files: those of the built
 * renderer, under `root`, and nothing else. A page this answers with is the app's, with its
 * storage, its IPC and the user's session with the server.
 */
export const answerFileRequest = async (request: Request, root: string): Promise<Response> => {
  const filePath = resolveAppFile(request.url, root)
  if (!filePath) return notFound()
  try {
    return await net.fetch(pathToFileURL(filePath).href)
  } catch {
    return notFound()
  }
}
