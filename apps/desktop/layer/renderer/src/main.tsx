import "./wdyr"
// Imported apart from main.css: the production Tailwind pass rewrites the whole sheet
// and loses the font files' relative url()s, so the fonts were never bundled
import "@follow/components/assets/font.css"
import "./styles/main.css"

import { IN_ELECTRON } from "@follow/shared/constants"
import { getOS } from "@follow/utils/utils"

import { ElECTRON_CUSTOM_TITLEBAR_HEIGHT } from "./constants/ui"
import { installChunkReloadHandler } from "./lib/chunk-reload"

installChunkReloadHandler()

if (IN_ELECTRON) {
  const os = getOS()

  switch (os) {
    case "Windows": {
      document.body.style.cssText += `--fo-window-padding-top: ${ElECTRON_CUSTOM_TITLEBAR_HEIGHT}px;`
      break
    }
    case "macOS": {
      document.body.style.cssText += `--fo-macos-traffic-light-width: 80px; --fo-macos-traffic-light-height: 30px;`
      break
    }
  }
  document.documentElement.dataset.os = getOS()
}

// Electron learns the server from its preload script. Until the user has set one, the app, whose
// modules capture the server's address as they load, cannot start; only the screen asking for it.
if (IN_ELECTRON && !window.__followEnv) {
  void import("./modules/server-setup/ServerSetupScreen").then(({ renderServerSetup }) =>
    renderServerSetup(),
  )
} else {
  void import("./bootstrap")
}
