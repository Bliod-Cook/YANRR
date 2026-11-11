import type { SpotlightRule } from "@follow/shared/spotlight"
import type { CompiledSpotlightRule } from "@follow/utils/spotlight"
import { buildHighlightSegments, compileSpotlightRules } from "@follow/utils/spotlight"

const compiledByRules = new WeakMap<SpotlightRule[], CompiledSpotlightRule[]>()

/** Every highlighted text of a list gets the same rules array, which is compiled once */
export const getCompiledSpotlightRules = (rules: SpotlightRule[]) => {
  let compiled = compiledByRules.get(rules)
  if (!compiled) {
    compiled = compileSpotlightRules(rules)
    compiledByRules.set(rules, compiled)
  }
  return compiled
}

export const getHighlightedTextSegments = (
  text: string | null | undefined,
  rules: SpotlightRule[],
) => buildHighlightSegments(text ?? "", getCompiledSpotlightRules(rules))
