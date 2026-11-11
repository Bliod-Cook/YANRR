import { IpcMethod, IpcService } from "electron-ipc-decorator"

import { setDockCount } from "../../lib/dock"

export class DockService extends IpcService {
  static override readonly groupName = "dock"

  /** The badge shows what the page counts as unread; nothing else writes it */
  @IpcMethod()
  setDockBadge(count: number): void {
    setDockCount(count)
  }
}
