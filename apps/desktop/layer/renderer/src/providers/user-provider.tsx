import { useAuthSessionCookieRefresh, useSession } from "~/queries/auth"

export const UserProvider = () => {
  const { session } = useSession()
  useAuthSessionCookieRefresh(!!session?.user)

  return null
}
