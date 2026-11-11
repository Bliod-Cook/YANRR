import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"

import type { ServerConfigs } from "@/src/atoms/server-configs"
import { setServerConfigs } from "@/src/atoms/server-configs"

import { followClient } from "../lib/api-client"

export const ServerConfigsLoader = () => {
  const serverConfigs = useServerConfigsQuery()

  useEffect(() => {
    if (!serverConfigs) return
    setServerConfigs(serverConfigs)
  }, [serverConfigs])

  return null
}

const useServerConfigsQuery = () => {
  const { data } = useQuery({
    queryKey: ["server-configs"],
    // The SDK still types the response of the Folo server
    queryFn: async () =>
      (await followClient.api.status.getConfigs()).data as unknown as ServerConfigs,
  })
  return data
}
