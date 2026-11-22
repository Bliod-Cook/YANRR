import { Button } from "@follow/components/ui/button/index.js"
import { Checkbox } from "@follow/components/ui/checkbox/index.js"
import { Divider } from "@follow/components/ui/divider/index.js"
import { Input } from "@follow/components/ui/input/index.js"
import { Label } from "@follow/components/ui/label/index.js"
import { env } from "@follow/shared/env.desktop"
import type { McpScope, McpToken } from "@follow/store/api-contract"
import { getApiUrl } from "@follow/utils/server-url"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { useServerCapability } from "~/atoms/server-configs"
import { CopyButton } from "~/components/ui/button/CopyButton"
import { RelativeTime } from "~/components/ui/datetime"
import { useCurrentModal, useDialog, useModalStack } from "~/components/ui/modal/stacked/hooks"
import { followApi } from "~/lib/api-client"
import { toastFetchError } from "~/lib/error-parser"

import { SettingSectionTitle } from "../../section"

const SCOPE_LABELS = {
  "feeds:read": "integration.mcp_server.scope.feeds",
  "entries:read": "integration.mcp_server.scope.entries",
  "history:read": "integration.mcp_server.scope.history",
} as const satisfies Record<McpScope, string>
const SCOPES = Object.keys(SCOPE_LABELS) as McpScope[]
const TOKENS_QUERY_KEY = ["mcp-tokens"]
// Where agents reach the server, rather than where the desktop app's requests go
const ENDPOINT = `${getApiUrl(env.VITE_WEB_URL)}/mcp`

/** The tokens agents reach the server's MCP endpoint with, when the server offers one */
export const McpSection = () => {
  const enabled = useServerCapability("mcp")
  if (!enabled) return null
  return (
    <>
      <Divider />
      <McpTokens />
    </>
  )
}

const CopyableCode = ({ value }: { value: string }) => (
  <div className="flex items-center gap-2">
    <code className="min-w-0 flex-1 break-all rounded bg-fill px-2 py-1 font-mono text-xs">
      {value}
    </code>
    <CopyButton value={value} variant="outline" />
  </div>
)

const McpTokens = () => {
  const { t } = useTranslation("settings")
  const { present } = useModalStack()
  const { ask } = useDialog()
  const queryClient = useQueryClient()
  const { data: tokens } = useQuery({
    queryKey: TOKENS_QUERY_KEY,
    queryFn: async () => (await followApi.mcpTokens.list()).data,
  })
  const revoke = useMutation({
    mutationFn: (id: string) => followApi.mcpTokens.delete({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY }),
    onError: (error) => toastFetchError(error),
  })

  const handleRevoke = async (token: McpToken) => {
    // An agent using the token stops working at once
    const confirmed = await ask({
      title: t("integration.mcp_server.revoke_title"),
      message: t("integration.mcp_server.revoke_message", { name: token.name }),
      confirmText: t("integration.mcp_server.revoke"),
      cancelText: t("words.cancel", { ns: "common" }),
      variant: "danger",
    })
    if (confirmed) revoke.mutate(token.id)
  }

  const handleCreate = () =>
    present({
      title: t("integration.mcp_server.create"),
      content: () => <CreateTokenModalContent />,
    })

  return (
    <div className="space-y-4">
      <SettingSectionTitle title={t("integration.mcp_server.title")} />
      <p className="text-sm text-text-secondary">{t("integration.mcp_server.description")}</p>
      <CopyableCode value={ENDPOINT} />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium leading-none">
          {t("integration.mcp_server.tokens")}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={handleCreate}
          buttonClassName="flex items-center"
        >
          <i className="i-mgc-add-cute-re mr-2" />
          {t("integration.mcp_server.create")}
        </Button>
      </div>
      {tokens?.length === 0 && (
        <p className="text-sm text-text-tertiary">{t("integration.mcp_server.empty")}</p>
      )}
      {tokens?.map((token) => (
        <div
          key={token.id}
          className="flex items-center gap-4 border-b border-fill-secondary pb-4 last:border-b-0 last:pb-0"
        >
          <div className="min-w-0 flex-1">
            <div className="font-medium text-text">{token.name}</div>
            <div className="text-xs text-text-tertiary">
              {token.scopes.join(", ")} ·{" "}
              {token.lastUsedAt ? (
                <>
                  {t("integration.mcp_server.last_used")} <RelativeTime date={token.lastUsedAt} />
                </>
              ) : (
                t("integration.mcp_server.never_used")
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleRevoke(token)}
            buttonClassName="size-8 p-0"
            aria-label={t("integration.mcp_server.revoke")}
          >
            <i className="i-mgc-delete-2-cute-re" />
          </Button>
        </div>
      ))}
    </div>
  )
}

const CreateTokenModalContent = () => {
  const { t } = useTranslation("settings")
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [scopes, setScopes] = useState<McpScope[]>(SCOPES)
  const create = useMutation({
    mutationFn: () => followApi.mcpTokens.create({ name: name.trim(), scopes }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY }),
    onError: (error) => toastFetchError(error),
  })

  const token = create.data?.data.token
  if (token) return <IssuedToken token={token} />

  const toggle = (scope: McpScope, checked: boolean) =>
    setScopes((current) =>
      checked ? [...current, scope] : current.filter((other) => other !== scope),
    )

  return (
    <form
      className="flex w-[400px] max-w-full flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        create.mutate()
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="mcp-token-name">{t("integration.mcp_server.name")}</Label>
        <Input
          id="mcp-token-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t("integration.mcp_server.scopes")}</legend>
        {SCOPES.map((scope) => (
          <label key={scope} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={scopes.includes(scope)}
              onCheckedChange={(checked) => toggle(scope, checked === true)}
            />
            {t(SCOPE_LABELS[scope])}
          </label>
        ))}
      </fieldset>
      <Button
        type="submit"
        disabled={!name.trim() || scopes.length === 0}
        isLoading={create.isPending}
      >
        {t("words.create", { ns: "common" })}
      </Button>
    </form>
  )
}

const IssuedToken = ({ token }: { token: string }) => {
  const { t } = useTranslation("settings")
  const { dismiss } = useCurrentModal()
  const command = `claude mcp add --transport http yanrr ${ENDPOINT} --header "Authorization: Bearer ${token}"`
  return (
    <div className="flex w-[480px] max-w-full flex-col gap-4">
      <p className="text-sm text-text-secondary">{t("integration.mcp_server.issued")}</p>
      <CopyableCode value={token} />
      <p className="text-sm text-text-secondary">{t("integration.mcp_server.example")}</p>
      <CopyableCode value={command} />
      <Button onClick={dismiss}>{t("words.done", { ns: "common" })}</Button>
    </div>
  )
}
