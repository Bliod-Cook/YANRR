import { usePushTokenRegistration } from "~/hooks/biz/usePushTokenRegistration"
import { useSession } from "~/queries/auth"

export const UserProvider = () => {
  useSession()
  usePushTokenRegistration()

  return null
}
