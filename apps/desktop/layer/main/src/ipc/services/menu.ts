import type { MenuItemConstructorOptions, WebContents } from "electron"
import { Menu, ShareMenu } from "electron"
import { getIpcContext, IpcMethod, IpcService } from "electron-ipc-decorator"

type SerializableMenuItem = Omit<MenuItemConstructorOptions, "click" | "submenu"> & {
  submenu?: SerializableMenuItem[]
}

interface ShowContextMenuInput {
  items: SerializableMenuItem[]
}

export class MenuService extends IpcService {
  static override readonly groupName = "menu"

  private normalizeMenuItems(
    items: SerializableMenuItem[],
    sender: WebContents,
    path: number[] = [],
  ): MenuItemConstructorOptions[] {
    return items.map((item, index) => {
      const curPath = [...path, index]
      return {
        ...item,
        click() {
          sender.send("menu-click", {
            id: item.id,
            path: curPath,
          })
        },
        submenu: item.submenu ? this.normalizeMenuItems(item.submenu, sender, curPath) : undefined,
      }
    })
  }

  @IpcMethod()
  async showContextMenu(input: ShowContextMenuInput): Promise<void> {
    const { sender } = getIpcContext()
    const defer = Promise.withResolvers<void>()
    const normalizedMenuItems = this.normalizeMenuItems(input.items, sender)

    const menu = Menu.buildFromTemplate(normalizedMenuItems)
    menu.popup({
      callback: () => defer.resolve(),
    })
    return defer.promise
  }

  @IpcMethod()
  async showShareMenu(input: string): Promise<void> {
    new ShareMenu({ urls: [input] }).popup()
  }
}
