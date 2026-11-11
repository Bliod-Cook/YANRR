import { useIsNewUser, useWhoami } from "@follow/store/user/hooks"
import { useQuery } from "@tanstack/react-query"
import { useAtomValueRawSync } from "jotai"
import { selectAtom } from "jotai/utils"
import { useEffect, useMemo, useRef } from "react"

import { useNavigation } from "../lib/navigation/hooks"
import { hasFinishedOnboarding } from "../lib/onboarding"
import { OnboardingScreen } from "../screens/OnboardingScreen"

export function useOnboarding() {
  const whoami = useWhoami()
  // The local flag settles it for everyone who finished, so only the others count their
  // subscriptions
  const { data: finished } = useQuery({
    enabled: !!whoami,
    queryKey: ["onboarding", "finished"],
    queryFn: hasFinishedOnboarding,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const isNewUser = useIsNewUser({ enabled: !!whoami && finished === false })
  const navigation = useNavigation()
  // The sign-in screen closes itself and what is open over it shortly after signing in, which
  // would also close an onboarding presented in the meantime, so it waits until nothing is open
  // over the tabs, such as the follow form of a link that was waiting for the sign-in
  const isAtRoot = useAtomValueRawSync(
    useMemo(
      () => selectAtom(navigation.__dangerous_getCtxValue().routesAtom, (r) => r.length === 0),
      [navigation],
    ),
  )
  const hasPresentedRef = useRef(false)
  useEffect(() => {
    if (hasPresentedRef.current || finished !== false || !isNewUser || !isAtRoot) return
    hasPresentedRef.current = true
    navigation.presentControllerView(OnboardingScreen, undefined, "fullScreenModal")
  }, [finished, isAtRoot, isNewUser, navigation])
}
