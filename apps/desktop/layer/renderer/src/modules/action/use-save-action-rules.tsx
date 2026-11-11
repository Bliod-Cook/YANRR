import { Button } from "@follow/components/ui/button/index.js"
import { useUpdateActionsMutation } from "@follow/store/action/hooks"
import type { ActionItem } from "@follow/store/action/store"
import {
  actionSyncService,
  isActionRulesConflictError,
  useActionStore,
} from "@follow/store/action/store"
import type { ActionRuleProblem } from "@follow/store/action/validation"
import { findActionRuleProblem, getRefusedActionRule } from "@follow/store/action/validation"
import type { TFunction } from "i18next"
import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useEventCallback } from "usehooks-ts"

import { useModalStack } from "~/components/ui/modal/stacked/hooks"
import { toastFetchError } from "~/lib/error-parser"

import { getRuleDisplayName } from "./rule-summary"

const ActionRulesConflictContent = ({
  dismiss,
  onReload,
  onOverwrite,
}: {
  dismiss: () => void
  onReload: () => void
  onOverwrite: () => void
}) => {
  const { t } = useTranslation("settings")

  return (
    <div className="flex max-w-[48ch] flex-col gap-3">
      <p className="text-sm text-text-secondary">{t("actions.conflict.message")}</p>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button variant="outline" onClick={dismiss}>
          {t("actions.conflict.keep_editing")}
        </Button>
        <Button
          variant="outline"
          textClassName="text-red"
          onClick={() => {
            dismiss()
            onOverwrite()
          }}
        >
          {t("actions.conflict.overwrite")}
        </Button>
        <Button
          onClick={() => {
            dismiss()
            onReload()
          }}
        >
          {t("actions.conflict.reload")}
        </Button>
      </div>
    </div>
  )
}

const problemMessageKeys = {
  incomplete_condition: "actions.save_incomplete_condition",
  invalid_regex: "actions.save_invalid_regex",
  invalid_webhook: "actions.save_invalid_webhook",
} as const

const describeRuleProblem = (
  { ruleIndex, kind }: ActionRuleProblem,
  rules: readonly ActionItem[],
  t: TFunction<"settings">,
) => t(problemMessageKeys[kind], { name: getRuleDisplayName(rules[ruleIndex], ruleIndex, t) })

/**
 * Saves the action rules unless one of them is not complete yet. When they were changed elsewhere
 * since they were loaded the server refuses the save, and the user chooses to load the latest
 * rules, which drops their edits, to keep editing, or to save over the other changes.
 */
export const useSaveActionRules = ({ onSuccess }: { onSuccess?: () => void } = {}) => {
  const { t } = useTranslation("settings")
  const { present } = useModalStack()

  const presentConflict = useEventCallback((overwrite: () => void) => {
    present({
      title: t("actions.conflict.title"),
      content: ({ dismiss }) => (
        <ActionRulesConflictContent
          dismiss={dismiss}
          onOverwrite={overwrite}
          onReload={() => {
            actionSyncService.fetchRules().catch((error: Error) => toastFetchError(error))
          }}
        />
      ),
      canClose: true,
      clickOutsideToDismiss: false,
    })
  })

  const mutation = useUpdateActionsMutation({
    onSuccess,
    onError: (error) => {
      if (isActionRulesConflictError(error)) {
        presentConflict(() => mutation.mutate({ overwrite: true }))
        return
      }
      const refused = getRefusedActionRule(error)
      if (refused) {
        toast.error(describeRuleProblem(refused, useActionStore.getState().rules, t), {
          description: refused.detail,
        })
        return
      }
      toastFetchError(error)
    },
  })

  // The pending state reaches the save button only after a render, too late for a double click
  const isSavingRef = useRef(false)
  const save = useEventCallback(() => {
    if (isSavingRef.current) return
    const { rules } = useActionStore.getState()
    const problem = findActionRuleProblem(rules)
    if (problem) {
      toast.error(describeRuleProblem(problem, rules, t))
      return
    }
    isSavingRef.current = true
    mutation.mutate(undefined, {
      onSettled: () => {
        isSavingRef.current = false
      },
    })
  })

  return { save, isPending: mutation.isPending }
}
