import { app } from "electron"
import squirrelStartup from "electron-squirrel-startup"

import { BootstrapManager } from "./manager/bootstrap"

if (squirrelStartup) {
  app.quit()
}

BootstrapManager.start()
