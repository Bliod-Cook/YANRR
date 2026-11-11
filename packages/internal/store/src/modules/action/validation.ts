import type { ActionFilterItem } from "@follow-app/client-sdk"
import { ExceptionCodeMap, FollowAPIError } from "@follow-app/client-sdk"

import type { ActionItem } from "./store"

/** What keeps a rule from being saved. */
export type ActionRuleProblem = {
  ruleIndex: number
  kind: "incomplete_condition" | "invalid_regex" | "invalid_webhook"
  /** The server's own words, such as why a regex does not compile. */
  detail?: string
}

// The server cannot read a condition without any of these
const isIncomplete = ({ field, operator, value }: ActionFilterItem) =>
  !field || !operator || value === undefined

/**
 * The first rule the server would refuse, found before saving: one with a condition it cannot
 * read, as a new condition starts out empty, or with an empty webhook.
 */
export const findActionRuleProblem = (rules: readonly ActionItem[]): ActionRuleProblem | null => {
  for (const [ruleIndex, rule] of rules.entries()) {
    if (rule.condition.some((group) => group.some(isIncomplete))) {
      return { ruleIndex, kind: "incomplete_condition" }
    }
    if (rule.result.webhooks?.some((webhook) => webhook.trim() === "")) {
      return { ruleIndex, kind: "invalid_webhook" }
    }
  }
  return null
}

// The server names what it refused by its path, a regex condition such as
// `rules.2.condition.0.1.value` or a webhook such as `rules.0.result.webhooks.3`, then says why
const REFUSED_RULE = /^`rules\.(\d+)\.(condition|result\.webhooks)\.[^`]*`: ([\s\S]*)$/

/** The rule a save was refused for, and why, or null when the error is about something else. */
export const getRefusedActionRule = (error: unknown): ActionRuleProblem | null => {
  if (
    !(error instanceof FollowAPIError) ||
    Number(error.code) !== ExceptionCodeMap.UnprocessableContent
  ) {
    return null
  }
  const match = REFUSED_RULE.exec(error.message)
  if (!match) return null
  return {
    ruleIndex: Number(match[1]),
    kind: match[2] === "condition" ? "invalid_regex" : "invalid_webhook",
    detail: match[3],
  }
}
