import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

import { resolve } from "pathe"
import { expect, it } from "vitest"

import { iconCollections } from "./icon-collections"

const workspaceRoot = resolve(import.meta.dirname, "../../..")

// `mgc` is MingCute's proprietary set, which Folo's license forbids redistributing.
const ICON_CLASS = /(?<![\w-])i-(mgc|mingcute|simple-icons|logos)-([\da-z]+(?:-[\da-z]+)*)/g

it("uses only icons from the bundled open-source collections", () => {
  const files = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)

  const unknown = new Set<string>()
  for (const file of files) {
    const source = readFileSync(resolve(workspaceRoot, file), "utf8")
    for (const [className, prefix, name] of source.matchAll(ICON_CLASS)) {
      const collection = iconCollections[prefix!]
      if (!collection?.icons[name!] && !collection?.aliases?.[name!]) {
        unknown.add(`${file}: ${className}`)
      }
    }
  }

  expect([...unknown]).toEqual([])
})
