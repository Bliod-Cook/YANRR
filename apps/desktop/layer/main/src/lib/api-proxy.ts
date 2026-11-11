import { createAuthRequestOriginHeaders } from "@follow/utils/headers"
import { net } from "electron"

/**
 * How long the server may take to start answering. A page that gives up earlier cannot say so
 * before there is an answer, and a request left waiting holds one of the few connections
 * Chromium opens to the server. Longer than any timeout of the pages themselves: OPML imports
 * and the AI-sorted timeline wait up to 3 minutes.
 */
const ANSWER_DEADLINE_MS = 240_000

/**
 * What the server said about its answer that the page must not get: the session cookie, which
 * lives in Chromium's cookie store only, and how the body was encoded, which Chromium undid.
 */
const HEADERS_KEPT_FROM_PAGE = ["set-cookie", "content-encoding", "content-length"]

/** Electron tells which origin made the request, which the page has no say in */
type PageRequest = Request & { initiatorOrigin?: string }

/** Chromium cancels the body when the page gives up on the answer */
const cancelling = (body: ReadableStream<Uint8Array> | null, onCancel: () => void) => {
  if (!body) return null
  const reader = body.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel: onCancel,
  })
}

/**
 * Answers a request of the app's page for the server's API with the server's answer, so that
 * the page reaches the API on its own origin, like the web app does on the server's.
 *
 * The request goes out through Chromium's network stack: with the session cookie from its
 * cookie store, where the server's `Set-Cookie` also ends up, through the proxy the app is set
 * to use, and with the server's own origin, the only one the server trusts. Bodies stream in
 * both directions, whatever bytes they hold.
 */
export const proxyApiRequest = async (
  request: PageRequest,
  { server, pageOrigin }: { server: string; pageOrigin: string },
) => {
  // Any other page that got an answer here, such as one in a webview, would act as the user
  if (request.initiatorOrigin !== pageOrigin) return new Response(null, { status: 403 })

  const { pathname, search } = new URL(request.url)
  const headers = new Headers(request.headers)
  headers.delete("cookie")
  for (const [name, value] of Object.entries(createAuthRequestOriginHeaders(server))) {
    headers.set(name, value)
  }

  const sent = new AbortController()
  // `duplex`: the body is sent as it arrives from the page
  const init: RequestInit & { duplex: "half" } = {
    method: request.method,
    headers,
    body: request.body,
    duplex: "half",
    credentials: "include",
    signal: sent.signal,
  }
  const deadline = setTimeout(() => sent.abort(), ANSWER_DEADLINE_MS)
  let response: Response
  try {
    response = await net.fetch(`${server}${pathname}${search}`, init)
  } finally {
    clearTimeout(deadline)
  }

  const answerHeaders = new Headers(response.headers)
  for (const name of HEADERS_KEPT_FROM_PAGE) answerHeaders.delete(name)

  return new Response(
    cancelling(response.body, () => sent.abort()),
    { status: response.status, statusText: response.statusText, headers: answerHeaders },
  )
}
