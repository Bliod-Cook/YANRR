import { FollowAPIError } from "@follow-app/client-sdk"
import { describe, expect, test } from "vitest"

import type { ActionItem } from "./store"
import { findActionRuleProblem, getRefusedActionRule } from "./validation"

const rule = (
  condition: ActionItem["condition"],
  result: ActionItem["result"] = {},
  index = 0,
): ActionItem => ({ name: `Rule ${index}`, condition, result, index })

const complete = { field: "entry_title", operator: "contains", value: "rust" } as const

describe("findActionRuleProblem", () => {
  test("finds the first rule with a condition the server cannot read", () => {
    const rules = [
      rule([[complete]]),
      rule([[complete], [complete, { field: "entry_title", operator: "contains" }]], {}, 1),
      rule([[{}]], {}, 2),
    ]

    expect(findActionRuleProblem(rules)).toEqual({ ruleIndex: 1, kind: "incomplete_condition" })
    expect(findActionRuleProblem([rule([[{ field: "view", value: "1" }]])])).toEqual({
      ruleIndex: 0,
      kind: "incomplete_condition",
    })
  })

  test("finds a rule with an empty webhook", () => {
    expect(
      findActionRuleProblem([rule([], { webhooks: ["https://a.example", " "] }), rule([[{}]])]),
    ).toEqual({ ruleIndex: 0, kind: "invalid_webhook" })
  })

  test("passes complete rules", () => {
    expect(
      findActionRuleProblem([rule([]), rule([[complete]], { webhooks: ["https://a.example"] })]),
    ).toBeNull()
  })
})

describe("getRefusedActionRule", () => {
  const refusal = (message: string) => new FollowAPIError(message, 422, "3")

  test("names the rule the server refused and why", () => {
    expect(
      getRefusedActionRule(
        refusal("`rules.2.condition.0.1.value`: Invalid regex: regex parse error:\n    a(\n"),
      ),
    ).toEqual({
      ruleIndex: 2,
      kind: "invalid_regex",
      detail: "Invalid regex: regex parse error:\n    a(\n",
    })
    expect(getRefusedActionRule(refusal("`rules.0.result.webhooks.3`: Invalid URL"))).toEqual({
      ruleIndex: 0,
      kind: "invalid_webhook",
      detail: "Invalid URL",
    })
  })

  test("leaves other errors alone", () => {
    expect(getRefusedActionRule(refusal("Invalid view"))).toBeNull()
    expect(
      getRefusedActionRule(new FollowAPIError("`rules.0.result.webhooks.0`: x", 400, "4")),
    ).toBeNull()
    expect(getRefusedActionRule(new Error("`rules.0.condition.0.0.value`: x"))).toBeNull()
  })
})
