import { SyncMetaService } from "@follow/database/services/sync-meta"
import type {
  ActionConditionIndex,
  ActionFeedField,
  ActionFilterItem,
  ActionId,
  ActionItem as ActionItemRes,
} from "@follow-app/client-sdk"
import { ExceptionCodeMap, FollowAPIError } from "@follow-app/client-sdk"
import { merge } from "es-toolkit/compat"

import { api } from "../../context"
import type { Hydratable, Resetable } from "../../lib/base"
import { createImmerSetter, createZustandStore } from "../../lib/helper"
import { registerSyncModel } from "../../sync/model-registry"
import { ensureSyncedThroughEngine } from "../../sync/sync-status"
import { filterOperatorOptions, getFilterFieldType } from "./constant"

export type ActionItem = Omit<ActionItemRes, "condition"> & {
  condition: ActionFilterItem[][]
  index: number
}

type ActionStore = {
  rules: ActionItem[]
  isDirty: boolean
  /** Whether confirmed rules are in the store, from the local database or from the server. */
  isLoaded: boolean
}

/** Why rules could not be imported, or how many were. */
export type ActionRulesImportResult =
  | { ok: true; count: number }
  | { ok: false; reason: "parse_failed"; detail: string }
  | {
      ok: false
      reason: "invalid_structure" | "invalid_name" | "invalid_condition" | "invalid_result"
    }

type ActionRules = ActionItem[]
export type ActionModel = ActionItem

/**
 * Which version of the rules the server has: their `updatedAt`, null when it has no rules, or
 * undefined when that is not known, such as for a copy an older app version stored.
 */
export type ActionRulesVersion = string | null | undefined

/** Whether a save was refused because the rules were changed elsewhere since they were loaded. */
export const isActionRulesConflictError = (error: unknown) =>
  error instanceof FollowAPIError && Number(error.code) === ExceptionCodeMap.ActionRulesConflict

const toRulesVersion = (updatedAt: unknown): string | undefined => {
  if (typeof updatedAt === "string") return updatedAt
  if (updatedAt instanceof Date) return updatedAt.toISOString()
  return undefined
}

export type SaveActionRulesOptions = {
  /** Replace the server's rules even if they were changed elsewhere since they were loaded. */
  overwrite?: boolean
}

export const useActionStore = createZustandStore<ActionStore>("action")(() => ({
  rules: [],
  isDirty: false,
  isLoaded: false,
}))

const immerSet = createImmerSetter(useActionStore)

/**
 * The rules the server confirmed, kept next to the sync engine's own bookkeeping: they are a
 * single document that the change log replaces as a whole, and the engine clears the table
 * when the account changes.
 */
const ACTION_RULES_DOCUMENT_KEY = "model:action"

const normalizeRules = (rules: ActionItemRes[] | null | undefined): ActionItem[] =>
  (rules ?? []).map((rule, index) => {
    const { condition } = rule
    // Older clients wrote a single group as a flat list
    const finalCondition =
      condition.length === 0 || Array.isArray(condition[0]) ? condition : [condition]

    return {
      ...rule,
      condition: finalCondition as ActionFilterItem[][],
      index,
    }
  })

/**
 * A condition on `field` filled in as far as the field allows: with its operator when it has only
 * one, and the default value of a status.
 */
const createCondition = (field: ActionFeedField): ActionFilterItem => {
  const type = getFilterFieldType(field)
  const operators = filterOperatorOptions.filter((option) => option.types.includes(type))
  return {
    field,
    ...(operators.length === 1 && { operator: operators[0]!.value }),
    ...(type === "status" && { value: "collected" }),
  }
}

class ActionSyncService {
  /**
   * @param keepLocalEdits leave rules the user is editing alone and only remember the
   * server's version. Used by the sync engine, which may run while the editor is open.
   */
  async fetchRules(options?: { keepLocalEdits?: boolean }) {
    const res = await api().actions.get()
    const { data } = res
    // An account without any rules gets no data at all, which means an empty rule set
    await actionActions.setConfirmedRules(normalizeRules(data?.rules), {
      overwriteLocalEdits: !options?.keepLocalEdits,
      version: data ? toRulesVersion(data.updatedAt) : null,
    })
    return res
  }

  /**
   * Make sure the rules in the store are current. With the sync engine running they were
   * hydrated from the local database and are kept fresh by the change log, so nothing is
   * requested; otherwise they are fetched.
   */
  async ensureRules() {
    if ((await ensureSyncedThroughEngine()) && actionActions.isLoaded()) {
      // A copy stored before versions were kept is fetched once to learn its version
      if (actionActions.getLoadedVersion() === undefined) {
        await this.fetchRules({ keepLocalEdits: true })
      }
      return
    }
    await this.fetchRules()
  }

  /**
   * Replace the server's rules with the ones in the store. Unless `overwrite` is set, this
   * fails with an error `isActionRulesConflictError` recognizes when the rules were changed
   * elsewhere since they were loaded, rather than overwriting those changes.
   */
  async saveRules(options?: SaveActionRulesOptions) {
    const { rules, isDirty } = useActionStore.getState()
    if (!isDirty) {
      return null
    }
    // Saving replaces every rule on the server, so it must wait until they were loaded. The
    // editors offer no rules to edit before, so this is never shown to the user.
    if (!actionActions.isLoaded()) {
      throw new Error("The action rules were not loaded")
    }

    // An unknown version cannot be checked, so such a save replaces the rules unconditionally
    const expectedUpdatedAt = options?.overwrite ? undefined : actionActions.getLoadedVersion()
    const res = await api().actions.put({
      rules: rules as any,
      ...(expectedUpdatedAt !== undefined && { expectedUpdatedAt }),
    })
    await actionActions.setSavedRules(rules, toRulesVersion(res.updatedAt))
    return res
  }
}

class ActionActions implements Hydratable, Resetable {
  // The version of the confirmed rules the rules in the store started from, which a save sends
  // so it fails if the rules changed since
  private loadedVersion: ActionRulesVersion = undefined

  /** Whether confirmed rules are in the store, from the local database or from the server. */
  isLoaded() {
    return useActionStore.getState().isLoaded
  }

  /** The version of the rules the store's rules started from. */
  getLoadedVersion(): ActionRulesVersion {
    return this.loadedVersion
  }

  private showConfirmedRules(rules: ActionRules, version: ActionRulesVersion) {
    immerSet((state) => {
      state.rules = rules
      state.isDirty = false
      state.isLoaded = true
    })
    this.loadedVersion = version
  }

  private async storeConfirmedRules(rules: ActionRules, version: ActionRulesVersion) {
    await SyncMetaService.set(
      ACTION_RULES_DOCUMENT_KEY,
      JSON.stringify({ rules, updatedAt: version }),
    ).catch((error) => {
      console.error("[action] failed to store the rules", error)
    })
  }

  private async readConfirmedRules(): Promise<{
    rules: ActionRules
    version: ActionRulesVersion
  } | null> {
    try {
      const stored = await SyncMetaService.get(ACTION_RULES_DOCUMENT_KEY)
      if (stored === null) return null
      const parsed = JSON.parse(stored) as { rules?: ActionRules; updatedAt?: unknown }
      if (!Array.isArray(parsed.rules)) return null
      return {
        rules: parsed.rules,
        version: parsed.updatedAt === null ? null : toRulesVersion(parsed.updatedAt),
      }
    } catch (error) {
      console.error("[action] failed to load the stored rules", error)
      return null
    }
  }

  async hydrate() {
    const confirmed = await this.readConfirmedRules()
    if (!confirmed) return
    this.showConfirmedRules(confirmed.rules, confirmed.version)
  }

  /**
   * Drop unsaved edits and go back to the rules the server confirmed. Otherwise the edits stay
   * in the store after the editor closes, and keep remote changes from showing up.
   */
  async discardLocalEdits() {
    if (!useActionStore.getState().isDirty) return
    const confirmed = await this.readConfirmedRules()
    if (confirmed) {
      this.showConfirmedRules(confirmed.rules, confirmed.version)
      return
    }
    await actionSyncService.fetchRules()
  }

  async reset() {
    useActionStore.setState({ rules: [], isDirty: false, isLoaded: false })
    this.loadedVersion = undefined
  }

  /**
   * Rules as the server has them. They are always written to the local database; the store
   * follows unless the user has unsaved edits that must not be replaced under their hands.
   */
  async setConfirmedRules(
    rules: ActionRules,
    options?: { overwriteLocalEdits?: boolean; version?: ActionRulesVersion },
  ) {
    const version = options?.version
    if (options?.overwriteLocalEdits || !useActionStore.getState().isDirty) {
      this.showConfirmedRules(rules, version)
    } else {
      immerSet((state) => {
        state.isLoaded = true
      })
    }
    await this.storeConfirmedRules(rules, version)
  }

  /**
   * Rules a save made the server's. Edits made while the save was on its way stay unsaved, but
   * now change the saved version, so the next save does not take that one for a change made
   * elsewhere.
   */
  async setSavedRules(rules: ActionRules, version: ActionRulesVersion) {
    if (useActionStore.getState().rules === rules) {
      this.showConfirmedRules(rules, version)
    } else {
      this.loadedVersion = version
    }
    await this.storeConfirmedRules(rules, version)
  }

  updateRules(rules: ActionRules) {
    immerSet((state) => {
      state.rules = rules
      state.isDirty = true
    })
  }

  patchRule(index: number, rule: Partial<ActionModel>) {
    immerSet((state) => {
      if (state.rules[index]) {
        state.rules[index] = merge(state.rules[index], rule)
        state.isDirty = true
      }
    })
  }

  addRule(getName: (index: number) => string) {
    immerSet((state) => {
      state.rules.push({
        name: getName(state.rules.length + 1),
        condition: [],
        index: state.rules.length,
        result: {},
      })
      state.isDirty = true
    })
  }

  pathCondition(index: ActionConditionIndex, condition: Partial<ActionFilterItem>) {
    immerSet((state) => {
      const rule = state.rules[index.ruleIndex]
      if (!rule) return
      const group = rule.condition[index.groupIndex]
      if (!group) return
      group[index.conditionIndex] = merge(group[index.conditionIndex], condition)
      state.isDirty = true
    })
  }

  changeConditionField(index: ActionConditionIndex, field: ActionFeedField) {
    immerSet((state) => {
      const group = state.rules[index.ruleIndex]?.condition[index.groupIndex]
      const item = group?.[index.conditionIndex]
      if (!group || !item) return
      // The operator and value only make sense for the previous field type
      group[index.conditionIndex] =
        getFilterFieldType(item.field) === getFilterFieldType(field)
          ? { ...item, field }
          : createCondition(field)
      state.isDirty = true
    })
  }

  addConditionItem(index: Omit<ActionConditionIndex, "conditionIndex">) {
    immerSet((state) => {
      const rule = state.rules[index.ruleIndex]
      if (!rule) return
      const group = rule.condition[index.groupIndex]
      if (!group) return
      group.push({})
      state.isDirty = true
    })
  }
  deleteConditionItem(index: ActionConditionIndex) {
    immerSet((state) => {
      const rule = state.rules[index.ruleIndex]
      if (!rule) return
      const group = rule.condition[index.groupIndex]
      if (!group) return
      group.splice(index.conditionIndex, 1)
      if (group.length === 0) {
        rule.condition.splice(index.groupIndex, 1)
      }
      state.isDirty = true
    })
  }

  addConditionGroup(index: Omit<ActionConditionIndex, "conditionIndex" | "groupIndex">) {
    immerSet((state) => {
      const rule = state.rules[index.ruleIndex]
      if (!rule) return
      rule.condition.push([{}])
      state.isDirty = true
    })
  }

  toggleRuleFilter(index: number) {
    immerSet((state) => {
      if (state.rules[index]) {
        const hasCustomFilters = state.rules[index].condition.length > 0
        state.rules[index].condition = hasCustomFilters ? [] : [[{}]]
        state.isDirty = true
      }
    })
  }

  deleteRuleAction(index: number, actionId: ActionId) {
    immerSet((state) => {
      if (state.rules[index]) {
        delete state.rules[index].result[actionId]
        state.isDirty = true
      }
    })
  }

  deleteRule(index: number) {
    immerSet((state) => {
      state.rules.splice(index, 1)
      state.rules.forEach((rule, ruleIndex) => {
        rule.index = ruleIndex
      })
      state.isDirty = true
    })
  }

  setDirty(isDirty: boolean) {
    immerSet((state) => {
      state.isDirty = isDirty
    })
  }

  addWebhook(index: number) {
    immerSet((state) => {
      const rule = state.rules[index]
      if (!rule) return
      const { webhooks } = rule.result
      if (!webhooks) {
        rule.result.webhooks = [""]
      } else {
        webhooks.push("")
      }
      state.isDirty = true
    })
  }

  deleteWebhook(index: number, webhookIndex: number) {
    immerSet((state) => {
      const rule = state.rules[index]
      if (!rule) return
      const { webhooks } = rule.result
      if (!webhooks) return
      if (webhooks.length === 1) {
        delete rule.result.webhooks
      } else {
        webhooks.splice(webhookIndex, 1)
      }
      state.isDirty = true
    })
  }

  updateWebhook({
    index,
    webhookIndex,
    value,
  }: {
    index: number
    webhookIndex: number
    value: string
  }) {
    immerSet((state) => {
      const rule = state.rules[index]
      if (!rule) return
      const { webhooks } = rule.result
      if (!webhooks) return
      webhooks[webhookIndex] = value
      state.isDirty = true
    })
  }

  addRewriteRule(index: number) {
    immerSet((state) => {
      const rule = state.rules[index]
      if (!rule) return
      const { rewriteRules } = rule.result
      if (!rewriteRules) {
        rule.result.rewriteRules = [
          {
            from: "",
            to: "",
          },
        ]
      } else {
        rewriteRules.push({ from: "", to: "" })
      }
      state.isDirty = true
    })
  }

  deleteRewriteRule(index: number, rewriteIdx: number) {
    immerSet((state) => {
      const rule = state.rules[index]
      if (!rule) return
      const { rewriteRules } = rule.result
      if (!rewriteRules) return
      if (rewriteRules.length === 1) {
        delete rule.result.rewriteRules
      } else {
        rewriteRules.splice(rewriteIdx, 1)
      }
      state.isDirty = true
    })
  }

  updateRewriteRule({
    index,
    rewriteRuleIndex,
    key,
    value,
  }: {
    index: number
    rewriteRuleIndex: number
    key: "from" | "to"
    value: string
  }) {
    immerSet((state) => {
      const rule = state.rules[index]
      if (!rule) return
      const { rewriteRules } = rule.result
      if (!rewriteRules) return
      const rewriteRule = rewriteRules[rewriteRuleIndex]
      if (!rewriteRule) return
      rewriteRule[key] = value
      state.isDirty = true
    })
  }

  exportRules(): string {
    const { rules } = useActionStore.getState()
    const exportData = {
      version: "1.0",
      exportDate: new Date().toISOString(),
      rules: rules.map((rule) => ({
        name: rule.name,
        condition: rule.condition,
        result: rule.result,
      })),
    }
    return JSON.stringify(exportData)
  }

  importRules(jsonData: string): ActionRulesImportResult {
    let parsedData: { rules?: unknown }
    try {
      parsedData = JSON.parse(jsonData)
    } catch (error) {
      return { ok: false, reason: "parse_failed", detail: String(error) }
    }

    const { rules } = parsedData ?? {}
    if (!Array.isArray(rules)) {
      return { ok: false, reason: "invalid_structure" }
    }
    for (const rule of rules) {
      // An empty name is allowed: the editor saves it and shows a numbered default instead
      if (typeof rule?.name !== "string") {
        return { ok: false, reason: "invalid_name" }
      }
      if (!Array.isArray(rule.condition)) {
        return { ok: false, reason: "invalid_condition" }
      }
      if (!rule.result || typeof rule.result !== "object") {
        return { ok: false, reason: "invalid_result" }
      }
    }

    const importedRules = normalizeRules(
      (rules as ActionItemRes[]).map(({ name, condition, result }) => ({
        name,
        condition,
        result,
      })),
    )
    immerSet((state) => {
      state.rules = importedRules
      state.isDirty = true
    })
    return { ok: true, count: importedRules.length }
  }
}

export const actionSyncService = new ActionSyncService()
export const actionActions = new ActionActions()

registerSyncModel("action", {
  bootstrap: async () => {
    await actionSyncService.fetchRules({ keepLocalEdits: true })
  },
  apply: async (action) => {
    const data = action.data as { rules?: ActionItemRes[]; updatedAt?: unknown } | null
    if (action.action !== "U" || !data || !Array.isArray(data.rules)) return
    await actionActions.setConfirmedRules(normalizeRules(data.rules), {
      version: toRulesVersion(data.updatedAt),
    })
  },
})
