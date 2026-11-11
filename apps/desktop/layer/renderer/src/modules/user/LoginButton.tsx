import { LucideLogIn } from "@follow/components/icons/user.jsx"
import { ActionButton } from "@follow/components/ui/button/index.js"
import { useTranslation } from "react-i18next"

import { useLoginModal } from "~/hooks/common"

export const LoginButton = () => {
  const presentLoginModal = useLoginModal()
  const { t } = useTranslation()
  return (
    <ActionButton
      data-testid="login-button"
      className="relative z-[1]"
      onClick={presentLoginModal}
      tooltip={t("words.login")}
    >
      <LucideLogIn className="size-5 text-text-secondary" />
    </ActionButton>
  )
}
