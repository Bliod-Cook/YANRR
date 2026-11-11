import { Button } from "@follow/components/ui/button/index.js"
import { LoadingWithIcon } from "@follow/components/ui/loading/index.jsx"
import * as ScrollArea from "@follow/components/ui/scroll-area/ScrollArea.js"
import {
  useActionRules,
  useIsActionDataDirty,
  useIsActionRulesLoaded,
  usePrefetchActions,
} from "@follow/store/action/hooks"
import type { ActionItem, ActionRulesImportResult } from "@follow/store/action/store"
import { actionActions, useActionStore } from "@follow/store/action/store"
import { cn } from "@follow/utils/utils"
import { useQueryClient } from "@tanstack/react-query"
import type { TFunction } from "i18next"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useBlocker } from "react-router"
import { toast } from "sonner"
import { useEventCallback } from "usehooks-ts"

import { MenuItemText, useShowContextMenu } from "~/atoms/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu/dropdown-menu.js"
import { useDialog } from "~/components/ui/modal/stacked/hooks"
import { useContextMenu } from "~/hooks/common/useContextMenu"
import { getI18n } from "~/i18n"
import { copyToClipboard, readFromClipboard } from "~/lib/clipboard"
import { downloadJsonFile, selectJsonFile } from "~/lib/export"
import { RuleCard } from "~/modules/action/rule-card"
import {
  buildActionSummary,
  buildConditionSummary,
  getRuleDisplayName,
} from "~/modules/action/rule-summary"

import { useSetSubViewActions } from "../app-layout/subview/hooks"
import { useSaveActionRules } from "./use-save-action-rules"
import { generateExportFilename } from "./utils"

// From this width the rules are listed beside the editor of the selected one
const WIDE_LAYOUT_MIN_WIDTH = 960

/** A ref for an element, and whether it is wide enough for the list beside the editor. */
const useIsWideLayout = () => {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [isWide, setIsWide] = useState(false)

  // Measured before the first paint, so a wide window does not show the narrow layout first
  useLayoutEffect(() => {
    if (!element) return
    const update = () => setIsWide(element.clientWidth >= WIDE_LAYOUT_MIN_WIDTH)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return [setElement, isWide] as const
}

const EmptyActionPlaceholder = ({ onCreateRule }: { onCreateRule: () => void }) => {
  const { t } = useTranslation(["settings", "common"])

  return (
    <div className="flex min-h-96 w-full items-center justify-center py-10">
      <div className="flex w-full max-w-xl flex-col items-center gap-6 rounded-3xl border border-fill-secondary bg-material-ultra-thin px-8 py-10 text-center shadow-sm">
        <div className="flex size-16 items-center justify-center rounded-2xl border border-fill-secondary bg-fill-quinary">
          <i className="i-mgc-magic-2-cute-re size-8 text-text-secondary" />
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-text">
            {t("actions.action_card.empty.title")}
          </h2>
          <p className="max-w-sm text-sm text-text-secondary">
            {t("actions.action_card.empty.description")}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button onClick={onCreateRule}>
            <i className="i-mgc-add-cute-re mr-2 size-4" />
            {t("actions.action_card.empty.cta")}
          </Button>
        </div>
      </div>
    </div>
  )
}

const ActionLoadError = ({ isRetrying, onRetry }: { isRetrying: boolean; onRetry: () => void }) => {
  const { t } = useTranslation(["settings", "common"])

  return (
    <div className="flex min-h-96 w-full flex-col items-center justify-center gap-3 py-10">
      <i className="i-mgc-warning-cute-re text-3xl text-red" />
      <span className="text-sm text-text-secondary">{t("actions.load_failed")}</span>
      <Button variant="outline" isLoading={isRetrying} onClick={onRetry}>
        {t("retry", { ns: "common" })}
      </Button>
    </div>
  )
}

export const ActionSetting = () => {
  const ruleCount = useActionRules((rules) => rules.length)
  const isLoaded = useIsActionRulesLoaded()
  const { t } = useTranslation("settings")

  const [selectedRuleIndex, setSelectedRuleIndex] = useState(0)
  const actionQuery = usePrefetchActions()
  const [layoutRef, isWide] = useIsWideLayout()

  useEffect(() => {
    if (selectedRuleIndex > Math.max(0, ruleCount - 1)) {
      setSelectedRuleIndex(Math.max(0, ruleCount - 1))
    }
  }, [ruleCount, selectedRuleIndex])

  const createRule = useEventCallback(() => {
    actionActions.addRule((number) => t("actions.actionName", { number }))
    setSelectedRuleIndex(useActionStore.getState().rules.length - 1)
  })

  // Every rule is deleted the same way, the last one too: the deletion is saved with the others
  const deleteRule = useEventCallback((index: number) => {
    actionActions.deleteRule(index)
    // The selection stays on the rule it was on, or moves to the one before a deleted one
    if (index <= selectedRuleIndex) {
      setSelectedRuleIndex(Math.max(0, selectedRuleIndex - 1))
    }
  })

  if (actionQuery.isPending) {
    return (
      <LoadingWithIcon
        className="flex h-64 items-center justify-center"
        icon={<i className="i-mgc-magic-2-cute-re" />}
        size="large"
      />
    )
  }

  // Saving sends every rule, so editing an empty list here would wipe the server's rules
  if (actionQuery.isError && !isLoaded) {
    return (
      <ActionLoadError isRetrying={actionQuery.isFetching} onRetry={() => actionQuery.refetch()} />
    )
  }

  return (
    <div ref={layoutRef} className="flex min-h-0 w-full flex-1 flex-col">
      <ActionButtonGroup onCreateRule={createRule} />
      <ShareImportSection />
      {ruleCount === 0 ? (
        <EmptyActionPlaceholder onCreateRule={createRule} />
      ) : isWide ? (
        <div className="absolute inset-x-0 bottom-0 top-12 flex overflow-hidden rounded-lg border border-fill-secondary">
          <RuleList
            selectedIndex={selectedRuleIndex}
            onSelect={setSelectedRuleIndex}
            onDelete={deleteRule}
          />
          <div className="flex flex-1 border-l border-fill-secondary">
            <RuleCard index={selectedRuleIndex} mode="detail" onDelete={deleteRule} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {Array.from({ length: ruleCount }, (_, ruleIndex) => (
            <RuleCard
              key={ruleIndex}
              index={ruleIndex}
              mode="compact"
              onDelete={deleteRule}
              defaultOpen={ruleIndex === selectedRuleIndex}
              onOpenChange={(open) => {
                if (open) {
                  setSelectedRuleIndex(ruleIndex)
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const toastImportResult = (result: ActionRulesImportResult, t: TFunction<"settings">) => {
  if (result.ok) {
    toast.success(t("actions.import_result.success", { count: result.count }))
  } else if (result.reason === "parse_failed") {
    toast.error(t("actions.import_result.parse_failed", { error: result.detail }))
  } else {
    toast.error(t(`actions.import_result.${result.reason}`))
  }
}

const ShareImportSection = () => {
  const { t } = useTranslation("settings")
  const actionLength = useActionRules((actions) => actions.length)
  const hasActions = actionLength > 0

  const handleExport = useCallback(() => {
    try {
      const jsonData = actionActions.exportRules()
      const filename = generateExportFilename()
      downloadJsonFile(jsonData, filename)
      toast.success(t("actions.share.export_success", { filename }))
    } catch {
      toast.error(t("actions.share.export_failed"))
    }
  }, [t])

  const handleImport = useCallback(async () => {
    let jsonData: string
    try {
      jsonData = await selectJsonFile()
    } catch (error) {
      if (error instanceof Error && error.message === "No file selected") {
        return
      }
      toast.error(t("actions.share.import_failed"))
      return
    }
    toastImportResult(actionActions.importRules(jsonData), t)
  }, [t])

  // The rules go to the clipboard as the JSON a file export holds
  const handleCopyToClipboard = useCallback(async () => {
    try {
      await copyToClipboard(actionActions.exportRules())
    } catch {
      // The failure has been shown already
      return
    }
    toast.success(t("actions.share.copy_success"))
  }, [t])

  const handleImportFromClipboard = useCallback(async () => {
    let jsonData: string
    try {
      jsonData = await readFromClipboard()
    } catch {
      // The failure has been shown already
      return
    }
    toastImportResult(actionActions.importRules(jsonData), t)
  }, [t])

  return (
    <div className="mb-4 flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            buttonClassName="size-9 p-0"
            aria-label={
              hasActions
                ? t("actions.action_card.summary.share")
                : t("actions.action_card.summary.import")
            }
          >
            <i
              className={cn(
                "size-4",
                hasActions ? "i-mgc-share-forward-cute-re" : "i-mgc-file-import-cute-re",
              )}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={handleExport} disabled={!hasActions}>
            <i className="i-mgc-download-2-cute-re mr-3 size-4" />
            {t("actions.action_card.summary.export")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleImport}>
            <i className="i-mgc-file-upload-cute-re mr-3 size-4" />
            {t("actions.action_card.summary.import_file")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCopyToClipboard} disabled={!hasActions}>
            <i className="i-mgc-copy-2-cute-re mr-3 size-4" />
            {t("actions.action_card.summary.copy")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleImportFromClipboard}>
            <i className="i-mgc-paste-cute-re mr-3 size-4" />
            {t("actions.action_card.summary.import_clipboard")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

const RuleList = ({
  selectedIndex,
  onSelect,
  onDelete,
}: {
  selectedIndex: number
  onSelect: (index: number) => void
  onDelete: (index: number) => void
}) => {
  const rules = useActionRules()
  const showContextMenu = useShowContextMenu()

  return (
    <div className="flex w-[260px] shrink-0 flex-col">
      <ScrollArea.ScrollArea rootClassName="h-full" viewportClassName="h-full">
        <div className="flex flex-col">
          {rules.map((rule, index) => (
            <RuleListItem
              key={rule.index ?? index}
              rule={rule}
              index={index}
              isActive={index === selectedIndex}
              onSelect={onSelect}
              handleDelete={onDelete}
              showContextMenu={showContextMenu}
            />
          ))}
        </div>
      </ScrollArea.ScrollArea>
    </div>
  )
}

const RuleListItem = ({
  rule,
  index,
  isActive,
  onSelect,
  handleDelete,
  showContextMenu,
}: {
  rule: ActionItem
  index: number
  isActive: boolean
  onSelect: (index: number) => void
  handleDelete: (index: number) => void
  showContextMenu: ReturnType<typeof useShowContextMenu>
}) => {
  const { t } = useTranslation("settings")
  const displayName = getRuleDisplayName(rule, index, t)
  const whenSummary = buildConditionSummary(rule, t)
  const actionSummary = buildActionSummary(rule, t)

  const contextMenuProps = useContextMenu({
    onContextMenu: async (e) => {
      e.preventDefault()
      await showContextMenu(
        [
          new MenuItemText({
            label: t("actions.action_card.summary.delete"),
            icon: <i className="i-mgc-delete-2-cute-re" />,
            click: () => handleDelete(index),
            requiresLogin: true,
          }),
        ],
        e,
      )
    },
  })

  return (
    <button
      type="button"
      onClick={() => onSelect(index)}
      {...contextMenuProps}
      className={cn(
        "flex flex-col gap-1 border-b border-fill-tertiary px-4 py-3 text-left transition-all last:border-b-0",
        isActive ? "bg-fill-quaternary" : "hover:bg-fill-quinary",
      )}
    >
      <span className="text-sm font-medium text-text">{displayName}</span>
      <span className="line-clamp-2 text-xs text-text-secondary">{whenSummary}</span>
      <span className="line-clamp-1 text-xs text-text-secondary">{actionSummary}</span>
    </button>
  )
}

const ActionButtonGroup = ({ onCreateRule }: { onCreateRule: () => void }) => {
  const queryClient = useQueryClient()
  const hasActions = useActionRules((actions) => actions.length > 0)
  const isDirty = useIsActionDataDirty()
  const { t } = useTranslation("settings")

  useUnSavedBlocker(isDirty)

  const { save, isPending } = useSaveActionRules({
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["entries"],
      })
      toast(t("actions.saveSuccess"))
    },
  })

  const setActions = useSetSubViewActions()
  useEffect(() => {
    setActions([
      {
        id: "new-rule",
        icon: "i-mingcute-add-line",
        label: t("actions.newRule"),
        onClick: onCreateRule,
      },
      // Shown while there is anything to save, deleting the last rule included
      ...(isDirty || hasActions
        ? [
            {
              id: "save",
              icon: "i-mgc-check-circle-cute-re",
              label: isPending ? t("actions.saving") : t("actions.save"),
              disabled: !isDirty,
              loading: isPending,
              onClick: save,
            },
          ]
        : []),
    ])
    return () => {
      setActions([])
    }
  }, [setActions, hasActions, isDirty, isPending, onCreateRule, save, t])

  return null
}

const useUnSavedBlocker = (isDirty: boolean) => {
  const navigationBlocker = useBlocker(({ currentLocation, nextLocation }) => {
    return isDirty && currentLocation.pathname !== nextLocation.pathname
  })

  const isRouterPromptOpenRef = useRef(false)
  const { ask } = useDialog()
  useEffect(() => {
    if (navigationBlocker.state !== "blocked") {
      isRouterPromptOpenRef.current = false
      return
    }
    if (isRouterPromptOpenRef.current) {
      return
    }
    isRouterPromptOpenRef.current = true
    const { t } = getI18n()
    ask({
      title: t("common:words.unsaved_changes"),
      message: t("settings:actions.navigate.prompt"),
      variant: "ask",
      onConfirm: () => {
        // Edits the user chose to leave behind must not stay in the store. This is not done on
        // unmount: narrowing the window swaps the layout and unmounts the editor too.
        actionActions.discardLocalEdits().catch(console.error)
        navigationBlocker.proceed()
      },
      // A blocker left in the blocked state swallows every later navigation without a prompt
      onCancel: () => navigationBlocker.reset(),
    })
  }, [ask, navigationBlocker])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const hasUnsavedChanges = isDirty
      if (!hasUnsavedChanges) {
        return
      }
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [isDirty])
}
