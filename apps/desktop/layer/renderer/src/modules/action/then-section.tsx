import { Button } from "@follow/components/ui/button/index.js"
import { Input } from "@follow/components/ui/input/index.js"
import type { ActionAction } from "@follow/store/action/constant"
import { availableActionMap } from "@follow/store/action/constant"
import { useActionRule } from "@follow/store/action/hooks"
import { actionActions } from "@follow/store/action/store"
import { cn } from "@follow/utils/utils"
import type { ActionId } from "@follow-app/client-sdk"
import type { FC } from "react"
import { Fragment, useMemo } from "react"
import { useTranslation } from "react-i18next"

import { useServerCapability } from "~/atoms/server-configs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu/dropdown-menu.js"

import { useSettingModal } from "../settings/modal/use-setting-modal-hack"

type ActionConfigProps = {
  index: number
  disabled?: boolean
}

const availableActions = Object.values(availableActionMap)
const AI_ACTIONS = new Set<ActionId>(["summary", "translation"])
// A server without AI cannot run the summary and translation actions
const isOffered = (action: ActionAction, aiEnabled: boolean) =>
  aiEnabled || !AI_ACTIONS.has(action.value)

export const ThenSection = ({ index }: { index: number }) => {
  const { t } = useTranslation("settings")
  const result = useActionRule(index, (a) => a.result)
  const settingModalPresent = useSettingModal()

  const disabled = useActionRule(index, (a) => a.result.disabled)
  const aiEnabled = useServerCapability("ai")

  const enabledActions = useMemo(() => {
    if (!result) return []

    // Get the order of actions from the result object (insertion order)
    const resultKeys = Object.keys(result).filter((key) => result[key as ActionId])

    // Sort availableActions based on the order in result object
    return resultKeys
      .map((key) => availableActionMap[key as ActionId])
      .filter(
        (action): action is NonNullable<typeof action> => !!action && isOffered(action, aiEnabled),
      )
  }, [result, aiEnabled])
  const notEnabledActions = useMemo(
    () =>
      availableActions.filter((action) => !result?.[action.value] && isOffered(action, aiEnabled)),
    [result, aiEnabled],
  )

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-orange text-[11px] font-bold text-white shadow-sm">
            2
          </span>
          <span className="text-sm font-bold tracking-wide text-text uppercase">
            {t("actions.action_card.then_do")}
          </span>
        </div>
        {enabledActions.length > 0 && (
          <span className="text-xs text-text-secondary">
            {t("actions.action_card.summary.action_count", { count: enabledActions.length })}
          </span>
        )}
      </div>

      <div className="relative flex flex-col">
        {enabledActions.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg bg-fill-quaternary px-4 py-6">
            <span className="text-xs text-text-secondary">
              {t("actions.action_card.summary.no_actions")}
            </span>
            <AddActionMenu index={index} disabled={disabled} actions={notEnabledActions} />
          </div>
        ) : (
          <>
            {enabledActions.map((action, actionIndex) => {
              const isLast = actionIndex === enabledActions.length - 1
              const Config = actionConfigs[action.value]
              return (
                <Fragment key={action.label}>
                  <div className="relative flex gap-4">
                    {/* Connection line and icon */}
                    <div className="relative flex flex-col items-center pt-0.5">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-material-ultra-thick text-text shadow-sm">
                        <i className={cn(action.iconClassname, "text-base")} />
                      </div>
                      {!isLast && (
                        <div className="absolute top-9 left-1/2 h-[calc(100%+0.75rem)] w-0.5 -translate-x-1/2 bg-gradient-to-b from-fill-secondary to-transparent" />
                      )}
                    </div>

                    {/* Action content */}
                    <div className="flex min-w-0 flex-1 flex-col gap-3 pt-0.5 pb-6">
                      <div className="flex items-center gap-4">
                        {/* Label */}
                        <span className="flex h-9 items-center text-sm font-medium text-text">
                          {t(action.label)}
                        </span>

                        {/* Spacer */}
                        <div className="flex-1" />

                        {/* Settings button */}
                        {action.settingsPath && (
                          <Button
                            variant="outline"
                            size="sm"
                            buttonClassName="rounded-lg"
                            onClick={() => {
                              settingModalPresent(action.settingsPath)
                            }}
                          >
                            {t("actions.action_card.settings")}
                          </Button>
                        )}

                        {/* Delete button */}
                        <IconButton
                          icon="i-mgc-delete-2-cute-re"
                          ariaLabel={t("actions.action_card.summary.delete")}
                          disabled={disabled}
                          className="hover:text-red"
                          onClick={() => {
                            actionActions.deleteRuleAction(index, action.value)
                          }}
                        />
                      </div>
                      {Config && (
                        <div className="rounded-lg bg-fill-quinary p-4">
                          <Config index={index} disabled={disabled} />
                        </div>
                      )}
                    </div>
                  </div>
                </Fragment>
              )
            })}
            <div className="relative flex gap-4">
              <div className="size-9 shrink-0" />
              <div className="pb-2">
                <AddActionMenu
                  index={index}
                  disabled={disabled}
                  actions={notEnabledActions}
                  align="start"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

const AddActionMenu = ({
  index,
  disabled,
  actions,
  align,
}: ActionConfigProps & { actions: ActionAction[]; align?: "start" }) => {
  const { t } = useTranslation("settings")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button variant="outline" size="sm" buttonClassName="border-dashed">
          <i className="mr-2 i-mgc-add-cute-re" />
          {t("actions.action_card.add")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-60">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            onClick={() => {
              if (action.onEnable) {
                action.onEnable(index)
              } else {
                actionActions.patchRule(index, { result: { [action.value]: true } })
              }
            }}
          >
            <div className="flex items-center gap-2">
              <i className={action.iconClassname} />
              {t(action.label)}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const RewriteRulesConfig = ({ index, disabled }: ActionConfigProps) => {
  const { t } = useTranslation("settings")
  const rewriteRules = useActionRule(index, (a) => a.result.rewriteRules)

  if (!rewriteRules || rewriteRules.length === 0) {
    return (
      <AddConfigButton
        label={t("actions.action_card.rewrite_rules")}
        disabled={disabled}
        onClick={() => actionActions.addRewriteRule(index)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {rewriteRules.map((rule, rewriteIdx) => {
        const change = (key: "from" | "to", value: string) => {
          actionActions.updateRewriteRule({
            index,
            rewriteRuleIndex: rewriteIdx,
            key,
            value,
          })
        }
        return (
          <div key={rewriteIdx} className="flex flex-col gap-3 rounded-lg bg-fill-quaternary p-4">
            <div className="grid gap-3 @[520px]:grid-cols-2">
              <label className="text-xs font-medium tracking-wide text-text-secondary uppercase">
                {t("actions.action_card.from")}
                <Input
                  disabled={disabled}
                  value={rule.from}
                  className="mt-2 h-9"
                  onChange={(event) => change("from", event.target.value)}
                />
              </label>
              <label className="text-xs font-medium tracking-wide text-text-secondary uppercase">
                {t("actions.action_card.to")}
                <Input
                  disabled={disabled}
                  value={rule.to}
                  className="mt-2 h-9"
                  onChange={(event) => change("to", event.target.value)}
                />
              </label>
            </div>
            <ItemButtons
              disabled={disabled}
              onAdd={() => actionActions.addRewriteRule(index)}
              onDelete={() => actionActions.deleteRewriteRule(index, rewriteIdx)}
            />
          </div>
        )
      })}
    </div>
  )
}

const WebhooksConfig = ({ index, disabled }: ActionConfigProps) => {
  const { t } = useTranslation("settings")
  const webhooks = useActionRule(index, (a) => a.result.webhooks)

  if (!webhooks || webhooks.length === 0) {
    return (
      <AddConfigButton
        label={t("actions.action_card.webhooks")}
        disabled={disabled}
        onClick={() => actionActions.addWebhook(index)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {webhooks.map((webhook, webhookIdx) => (
        <div key={webhookIdx} className="flex flex-col gap-2 rounded-lg bg-fill-quaternary p-4">
          <Input
            disabled={disabled}
            value={webhook}
            className="h-9"
            placeholder="https://"
            onChange={(event) => {
              actionActions.updateWebhook({
                index,
                webhookIndex: webhookIdx,
                value: event.target.value,
              })
            }}
          />
          <ItemButtons
            disabled={disabled}
            onAdd={() => actionActions.addWebhook(index)}
            onDelete={() => actionActions.deleteWebhook(index, webhookIdx)}
          />
        </div>
      ))}
    </div>
  )
}

// What an action is set up with besides being on
const actionConfigs: Partial<Record<ActionId, FC<ActionConfigProps>>> = {
  rewriteRules: RewriteRulesConfig,
  webhooks: WebhooksConfig,
}

const AddConfigButton = ({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
}) => (
  <button
    type="button"
    disabled={disabled}
    className="flex w-full items-center justify-between rounded-lg bg-fill-quaternary px-4 py-3 text-xs text-text-tertiary transition-colors hover:bg-fill-tertiary hover:text-text disabled:opacity-50"
    onClick={onClick}
  >
    <span>{label}</span>
    <i className="i-mgc-add-cute-re" />
  </button>
)

const ItemButtons = ({
  disabled,
  onAdd,
  onDelete,
}: {
  disabled?: boolean
  onAdd: () => void
  onDelete: () => void
}) => {
  const { t } = useTranslation("settings")
  return (
    <div className="flex items-center justify-end gap-2">
      <IconButton
        icon="i-mgc-add-cute-re"
        ariaLabel={t("actions.action_card.add")}
        disabled={disabled}
        onClick={onAdd}
      />
      <IconButton
        icon="i-mgc-delete-2-cute-re"
        className="hover:text-red"
        ariaLabel={t("actions.action_card.summary.delete")}
        disabled={disabled}
        onClick={onDelete}
      />
    </div>
  )
}

const IconButton = ({
  icon,
  onClick,
  ariaLabel,
  disabled,
  className,
}: {
  icon: string
  onClick: () => void
  ariaLabel: string
  disabled?: boolean
  className?: string
}) => {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn(
        "flex size-6 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-fill-quaternary hover:text-text disabled:opacity-50",
        className,
      )}
      onClick={onClick}
    >
      <i className={icon} />
    </button>
  )
}
