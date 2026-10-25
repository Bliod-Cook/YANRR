// Lists the commits that carry MingCute's proprietary MGC icons, which Folo's license forbids
// redistributing: files named after them, and changes holding their path data, taken from Folo's
// `icons/mgc`. Run it before pushing a sync with Folo; it exits with 1 when it finds any.
// Usage: pnpm run icons:check-mgc [<revision>...] (default: HEAD)
import { execFileSync } from "node:child_process"

import { icons } from "@iconify-json/mingcute"

const MGC_SOURCE = "upstream/dev"

// Without replace refs, as a push sees the history: grafts lead into Folo's own commits
const git = (args: string[], input?: string) =>
  execFileSync("git", ["--no-replace-objects", ...args], {
    encoding: "utf8",
    input,
    maxBuffer: 1 << 30,
  })

const revisions = process.argv.slice(2)
if (revisions.length === 0) revisions.push("HEAD")

const svgs = git(["ls-tree", "-r", "--name-only", MGC_SOURCE, "--", "icons/mgc"])
  .split("\n")
  .filter((file) => file.endsWith(".svg"))
const svgSource = git(
  ["cat-file", "--batch"],
  svgs.map((file) => `${MGC_SOURCE}:${file}`).join("\n"),
)
// Some MGC icons are drawn exactly like open-source ones, and some only start alike
const openSource = Object.values(icons.icons)
  .map(({ body }) => body)
  .join("\n")
const pathData = new Set<string>()
for (const [, data] of svgSource.matchAll(/ d="([^"]{40,})"/g)) {
  // The start alone also finds copies that were reformatted further on
  const start = data!.slice(0, 40)
  if (!openSource.includes(start)) pathData.add(start)
  else if (!openSource.includes(data!)) pathData.add(data!)
}

const log = (args: string[]) =>
  git(["log", "--full-history", "--no-renames", "--format=%h %s", "--name-only", ...args]).trim()

const findings = [
  log([...revisions, "--", "icons/mgc", ":(glob)**/*_cute[_-]*", ":(glob)**/*_cute[_-]*/**"]),
  log([
    "-P",
    "-G",
    Array.from(pathData, (data) => data.replaceAll(".", "\\.")).join("|"),
    ...revisions,
    "--",
    ":!icons/mgc",
  ]),
].filter(Boolean)

if (findings.length > 0) {
  console.info(findings.join("\n\n"))
  process.exitCode = 1
}
