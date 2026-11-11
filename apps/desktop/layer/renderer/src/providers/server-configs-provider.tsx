import { useEffect } from "react"

import { setServerConfigs } from "~/atoms/server-configs"
import { useServerConfigsQuery } from "~/queries/server-configs"

export const ServerConfigsProvider = () => {
  const serverConfigs = useServerConfigsQuery()

  useEffect(() => {
    if (serverConfigs) setServerConfigs(serverConfigs)
  }, [serverConfigs])

  return null
}
