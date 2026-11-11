import { useQuery } from "@tanstack/react-query"

import type { ServerConfigs } from "~/atoms/server-configs"
import { followApi } from "~/lib/api-client"

export const useServerConfigsQuery = () => {
  const { data } = useQuery({
    queryKey: ["server-configs"],
    // The SDK types the answer of the upstream Folo server, not this one's
    queryFn: async () => (await followApi.status.getConfigs()).data as unknown as ServerConfigs,
  })
  return data
}
