import { Button } from "@follow/components/ui/button/index.js"
import { Input } from "@follow/components/ui/input/Input.js"
import type { FormEvent } from "react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { ipcServices } from "~/lib/client"

type ServerUrlError = "invalid" | "unreachable" | "failed"

/**
 * Sets the server the desktop app talks to, then relaunches the app, which takes the server's
 * address at startup. `beforeRelaunch` clears what is left from the server before. The new
 * address is kept only once that succeeded: when it fails, the app stays open on the server
 * before, as relaunching would carry its data over to the new one.
 */
export const ServerUrlForm = ({ beforeRelaunch }: { beforeRelaunch?: () => Promise<void> }) => {
  const { t } = useTranslation("app")
  const [url, setUrl] = useState("")
  const [error, setError] = useState<ServerUrlError | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setIsConnecting(true)
    try {
      const checked = await ipcServices?.auth.checkServerUrl(url)
      if (!checked) return
      if ("error" in checked) {
        setError(checked.error)
        setIsConnecting(false)
        return
      }
      await beforeRelaunch?.()
      await ipcServices?.auth.setServerUrl(checked.server)
    } catch (error) {
      console.error("Failed to switch the server", error)
      setError("failed")
      setIsConnecting(false)
      return
    }
    ipcServices?.app.relaunch()
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
