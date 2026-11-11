import { app, protocol } from "electron"
import path from "pathe"

import { e2eUserDataDir } from "./env"
import { getDevServerUrl } from "./lib/page-origin"

if (e2eUserDataDir) {
  app.setPath("userData", e2eUserDataDir)
} else if (import.meta.env.DEV) {
  app.setPath("userData", path.join(app.getPath("appData"), "Yanrr(dev)"))
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      bypassCSP: true,
      supportFetchAPI: true,
      secure: true,
      // While developing, the pages come from the dev server, another origin than that of the
      // API behind this protocol. Chromium then leaves it to `api-proxy` to say who may ask.
      corsEnabled: !!getDevServerUrl(),
    },
  },
])
