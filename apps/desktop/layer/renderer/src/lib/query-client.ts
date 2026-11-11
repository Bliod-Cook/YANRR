import { FollowAPIError } from "@follow-app/client-sdk"
import { QueryClient } from "@tanstack/react-query"

const defaultStaleTime = 600_000 // 10min
// A timeout (408) waited the whole time already: each retry would wait as long again, for minutes
const DO_NOT_RETRY_CODES = new Set([400, 401, 403, 404, 408, 422])
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retryDelay: 1000,
      staleTime: defaultStaleTime,
      retry(failureCount, error) {
        if (error instanceof FollowAPIError && DO_NOT_RETRY_CODES.has(error.status)) {
          return false
        }

        return failureCount < 3
      },
    },
    // TanStack pauses mutations before they run while the browser is offline, and a paused
    // mutation has no function after a reload, so a star or a read toggle made offline did
    // nothing and was lost with the window. Entry actions record their intent in the
    // transaction queue, which waits for the network itself; the rest fail with their error.
    mutations: {
      networkMode: "always",
    },
  },
})
