import { useIsLoggedIn } from "@follow/store/user/hooks"
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"

import { setImageProxy } from "~/atoms/image-proxy"
import { followApi } from "~/lib/api-client"

/** Keeps the server's image proxy current; only signed-in users get it */
export const ImageProxyProvider = () => {
  const isLoggedIn = useIsLoggedIn()
  const { data } = useQuery({
    queryKey: ["image-proxy"],
    queryFn: async () => (await followApi.imageProxy.get()).data,
    enabled: isLoggedIn,
  })

  useEffect(() => {
    if (data !== undefined) setImageProxy(data)
  }, [data])

  return null
}
