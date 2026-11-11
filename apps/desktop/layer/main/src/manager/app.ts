import { PushReceiver } from "@eneris/push-receiver"
import { callWindowExpose } from "@follow/shared/bridge"
import { APP_ID, APP_PROTOCOL } from "@follow/shared/constants"
import { app, nativeTheme, Notification } from "electron"
import contextMenu from "electron-context-menu"
import path from "pathe"

import { WindowManager } from "~/manager/window"

import { isTestRun } from "../env"
import { getIconPath } from "../helper"
import { initializeIpcServices } from "../ipc"
import { PUSH_TOKEN_CHANNEL } from "../ipc/channels"
import { saveMediaToEagle } from "../ipc/services/integration"
import { t } from "../lib/i18n"
import { openExternalSafely } from "../lib/open-external"
import { updateProxy } from "../lib/proxy"
import { store } from "../lib/store"
import { registerAppTray } from "../lib/tray"
import { logger } from "../logger"
import { registerAppMenu } from "../menu"

class AppManagerStatic {
  private static instance: AppManagerStatic

  public static getInstance(): AppManagerStatic {
    if (!AppManagerStatic.instance) {
      AppManagerStatic.instance = new AppManagerStatic()
    }
    return AppManagerStatic.instance
  }

  public init() {
    initializeIpcServices()
    void app.whenReady().then(() => this.onReady())
  }

  private onReady() {
    this.registerProtocols()
    this.setupAppVisuals()
    this.setupSystemConfigs()
    this.registerMenuAndContextMenu()
    this.registerPushNotifications()

    updateProxy()
    registerAppTray()
  }

  private registerProtocols() {
    // The links of the installed app, e.g. sign-in callbacks, would open this test build
    if (isTestRun) return

    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [
          path.resolve(process.argv[1]!),
        ])
      }
    } else {
      app.setAsDefaultProtocolClient(APP_PROTOCOL)
    }
  }

  private setupAppVisuals() {
    // Packaged builds already ship the right bundle icon, and macOS derives its dark and tinted
    // appearances from it. A runtime image would pin the Dock to one static icon, so only unpackaged
    // runs, which would otherwise show Electron's default icon, set it here.
    if (app.dock && !app.isPackaged) {
      app.dock.setIcon(getIconPath())
    }
  }

  private setupSystemConfigs() {
    const appearance = store.get("appearance")
    if (appearance && ["light", "dark", "system"].includes(appearance)) {
      nativeTheme.themeSource = appearance
    }
  }

  private async registerPushNotifications() {
    const firebaseConfig = import.meta.env.VITE_FIREBASE_CONFIG
    if (!firebaseConfig) {
      return
    }

    const credentialsKey = "notifications-credentials"
    const persistentIdsKey = "notifications-persistent-ids"
    const credentials = store.get(credentialsKey)
    const persistentIds = store.get(persistentIdsKey)

    const instance = new PushReceiver({
      debug: false,
      firebase: JSON.parse(firebaseConfig),
      persistentIds: persistentIds || [],
      credentials: credentials || undefined,
      bundleId: APP_ID,
      chromeId: APP_ID,
    })
    logger.info("PushReceiver initialized")

    instance.onReady(() => {
      logger.info("PushReceiver ready")
    })

    instance.onCredentialsChanged(({ newCredentials }) => {
      logger.info("PushReceiver credentials changed")
      store.set(credentialsKey, newCredentials)
      // The page hands the token to the server, as the signed-in user
      const mainWindow = WindowManager.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(PUSH_TOKEN_CHANNEL)
      }
    })

    instance.onNotification((notification) => {
      logger.info("PushReceiver received notification")
      const { data } = notification.message
      if (!data) {
        return
      }
      switch (data.type) {
        case "new-entry": {
          const notification = new Notification({
            title: data.title as string,
            body: data.description as string,
          })
          notification.on("click", () => {
            const mainWindow = WindowManager.getMainWindowOrCreate()
            WindowManager.showMainWindow(mainWindow)
            const handlers = callWindowExpose(mainWindow)
            handlers.navigateEntry({
              feedId: data.feedId as string,
              entryId: data.entryId as string,
              view: Number.parseInt(data.view as string),
            })
          })
          notification.show()
          break
        }
        default: {
          break
        }
      }
      store.set(persistentIdsKey, instance.persistentIds)
    })

    try {
      await instance.connect()
      logger.info("PushReceiver connected")
    } catch {
      logger.error("PushReceiver connection failed")
    }
  }

  private contextMenuDisposer?: () => void
  public registerMenuAndContextMenu() {
    registerAppMenu()
    if (this.contextMenuDisposer) {
      this.contextMenuDisposer()
    }

    this.contextMenuDisposer = contextMenu({
      showSaveImageAs: true,
      showCopyLink: true,
      showCopyImageAddress: true,
      showCopyImage: true,
      showInspectElement: import.meta.env.DEV,
      showSelectAll: true,
      showCopyVideoAddress: true,
      showSaveVideoAs: true,

      labels: {
        saveImageAs: t("contextMenu.saveImageAs"),
        copyLink: t("contextMenu.copyLink"),
        copyImageAddress: t("contextMenu.copyImageAddress"),
        copyImage: t("contextMenu.copyImage"),
        copyVideoAddress: t("contextMenu.copyVideoAddress"),
        saveVideoAs: t("contextMenu.saveVideoAs"),
        inspect: t("contextMenu.inspect"),
        copy: t("contextMenu.copy"),
        cut: t("contextMenu.cut"),
        paste: t("contextMenu.paste"),
        saveImage: t("contextMenu.saveImage"),
        saveVideo: t("contextMenu.saveVideo"),
        selectAll: t("contextMenu.selectAll"),
        services: t("contextMenu.services"),
        searchWithGoogle: t("contextMenu.searchWithGoogle"),
        learnSpelling: t("contextMenu.learnSpelling"),
        lookUpSelection: t("contextMenu.lookUpSelection"),
        saveLinkAs: t("contextMenu.saveLinkAs"),
      },

      prepend: (_defaultActions, params) => {
        return [
          {
            label: t("contextMenu.saveMediaToEagle"),
            visible:
              params.mediaType === "image" &&
              params.srcURL !== "" &&
              !!store.get("eagleContextMenuEnabled"),
            click: () => {
              void saveMediaToEagle({
                url: params.pageURL || params.srcURL,
                mediaUrls: [params.srcURL],
              })
            },
          },
          {
            label: t("contextMenu.openImageInBrowser"),
            visible: params.mediaType === "image",
            click: () => {
              void openExternalSafely(params.srcURL)
            },
          },
          {
            label: t("contextMenu.openLinkInBrowser"),
            visible: params.linkURL !== "",
            click: () => {
              void openExternalSafely(params.linkURL)
            },
          },
          {
            role: "undo",
            label: t("menu.undo"),
            accelerator: "CmdOrCtrl+Z",
            visible: params.isEditable,
          },
          {
            role: "redo",
            label: t("menu.redo"),
            accelerator: "CmdOrCtrl+Shift+Z",
            visible: params.isEditable,
          },
        ]
      },
    })
  }
}

export const AppManager = AppManagerStatic.getInstance()
