import { Button } from "@follow/components/ui/button/index.js"
import { Input } from "@follow/components/ui/input/Input.js"
import type { FormEvent } from "react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { ipcServices } from "~/lib/client"

type ServerUrlError = "invalid" | "unreachable"

/**
 * Sets the server the desktop app talks to, then relaunches the app, which takes the server's
 * address at startup. `beforeRelaunch` clears what is left from the server before.
 */
export const ServerUrlForm = ({ beforeRelaunch }: { beforeRelaunch?: () => Promise<void> }) => {
  const { t } = useTranslation("app")
  const [url, setUrl] = useState("")
  const [error, setError] = useState<ServerUrlError | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setIsConnecting(true)
    const result = await ipcServices?.auth.setServerUrl(url)
    if (result) {
      setError(result)
      setIsConnecting(false)
      return
    }

    try {
      await beforeRelaunch?.()
    } finally {
      ipcServices?.app.relaunch()
    }
  }

  return (
    <form data-testid="server-url-form" className="flex w-full flex-col gap-3" onSubmit={onSubmit}>
      <Input
        data-testid="server-url-input"
        aria-label={t("server.address")}
        placeholder="https://rss.example.com"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
        value={url}
        onChange={(event) => {
          setUrl(event.target.value)
          setError(null)
        }}
      />
      {error && <p className="text-sm text-red">{t(`server.${error}` as const)}</p>}
      <Button
        data-testid="server-url-submit"
        type="submit"
        size="lg"
        isLoading={isConnecting}
        disabled={!url.trim()}
      >
        {t("server.connect")}
      </Button>
    </form>
  )
}
