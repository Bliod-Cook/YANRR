import { existsSync } from "node:fs"
import { createRequire } from "node:module"

import { app, nativeTheme } from "electron"
import { IpcMethod, IpcService } from "electron-ipc-decorator"
import path from "pathe"

import { START_IN_TRAY_ARGS } from "~/constants/app"

import { setProxyConfig, updateProxy } from "../../lib/proxy"
import { store } from "../../lib/store"
import { getTrayConfig, setTrayConfig } from "../../lib/tray"

const require = createRequire(import.meta.url)

/**
 * The command that starts the app at login on Windows. A Squirrel install keeps each version in
 * a folder of its own next to `Update.exe` and a launcher that starts the installed version, so
 * the login item names the launcher: the versioned path is gone after the next install.
 */
const getLoginItem = () => {
  const installDir = path.dirname(path.dirname(process.execPath))
  const isSquirrelInstall = existsSync(path.join(installDir, "Update.exe"))
  return {
    path: isSquirrelInstall
      ? path.join(installDir, path.basename(process.execPath))
      : process.execPath,
    // Start hidden in the tray when launched at login and the tray icon is enabled. Only
    // Windows passes the arguments, a login launch on macOS is detected in `AppService`
    args: [START_IN_TRAY_ARGS],
  }
}

export class SettingService extends IpcService {
  static override readonly groupName = "setting"

  @IpcMethod()
  getLoginItemSettings(): Electron.LoginItemSettings {
    // Windows matches the login item against the command it is asked about
    return app.getLoginItemSettings(getLoginItem())
  }

  /** Whether the app, and nothing else a page could name, starts when the user logs in */
  @IpcMethod()
  setOpenAtLogin(enabled: boolean): void {
    app.setLoginItemSettings({ openAtLogin: enabled, ...getLoginItem() })
  }

  @IpcMethod()
  async getSystemFonts(): Promise<string[]> {
    const fonts = await require("font-list").getFonts()
    return fonts.map((font: string) => font.replaceAll('"', ""))
  }

  @IpcMethod()
  getAppearance(): "light" | "dark" | "system" {
    return nativeTheme.themeSource
  }

  @IpcMethod()
  setAppearance(appearance: "light" | "dark" | "system"): void {
    nativeTheme.themeSource = appearance
    store.set("appearance", appearance)
  }

  @IpcMethod()
  getMinimizeToTray(): boolean {
    return getTrayConfig()
  }

  @IpcMethod()
  setMinimizeToTray(minimize: boolean): boolean {
    return setTrayConfig(minimize)
  }

  @IpcMethod()
  getProxyConfig() {
    const proxy = store.get("proxy")
    return proxy ?? undefined
  }

  @IpcMethod()
  setProxyConfig(config: string) {
    const result = setProxyConfig(config)
    updateProxy()
    return result
  }

  /** The token the server sends this device's push notifications to, once there is one */
  @IpcMethod()
  getMessagingToken(): string | null {
    return store.get("notifications-credentials")?.fcm?.token ?? null
  }
}
