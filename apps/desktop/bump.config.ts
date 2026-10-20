/* eslint-disable no-template-curly-in-string */
import { defineConfig } from "nbump"

export default defineConfig({
  leading: ["git pull --rebase"],
  trailing: ["git checkout -b release/desktop/${NEW_VERSION}"],
  finally: [
    "git push origin release/desktop/${NEW_VERSION}",
    "gh pr create --title 'release(desktop): Release v${NEW_VERSION}' --body 'v${NEW_VERSION}' --base main --head release/desktop/${NEW_VERSION}",
  ],
  push: false,
  commitMessage: "release(desktop): release v${NEW_VERSION}",
  tagPrefix: "desktop@",
  changelog: false,
  allowedBranches: ["dev"],
})
