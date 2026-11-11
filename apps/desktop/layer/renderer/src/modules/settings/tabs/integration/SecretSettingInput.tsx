import type { ReactNode } from "react"
import { useState } from "react"

import type { IntegrationSecretKey } from "~/modules/integration/secrets"
import { useIntegrationSecret, writeIntegrationSecret } from "~/modules/integration/secrets"

import { SettingDescription, SettingInput } from "../../control"
import { SettingItemGroup } from "../../section"

/** A token or password of a built-in integration, saved as it is typed */
export const SecretSettingInput = ({
  secretKey,
  label,
  description,
}: {
  secretKey: IntegrationSecretKey
  label: string
  description?: ReactNode
}) => {
  const saved = useIntegrationSecret(secretKey)
  // The desktop app answers a save a moment later; the input must not wait for that
  const [typed, setTyped] = useState<string>()

  return (
    <SettingItemGroup>
      <SettingInput
        vertical
        type="password"
        className="mt-4"
        label={label}
        value={typed ?? saved}
        onChange={(event) => {
          setTyped(event.target.value)
          void writeIntegrationSecret(secretKey, event.target.value)
        }}
      />
      {!!description && <SettingDescription>{description}</SettingDescription>}
    </SettingItemGroup>
  )
}
