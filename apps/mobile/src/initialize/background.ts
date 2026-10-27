import { getUnreadAll } from "@follow/store/unread/getters"
import { unreadSyncService } from "@follow/store/unread/store"
import { whoami } from "@follow/store/user/getters"
import * as BackgroundTask from "expo-background-task"
import * as TaskManager from "expo-task-manager"

import { getUISettings } from "../atoms/settings/ui"
import { setBadgeCountAsyncWithPermission } from "../lib/permission"

const BACKGROUND_FETCH_TASK = "background-fetch"
/** The system decides when the task actually runs, never sooner than this */
const MINIMUM_INTERVAL_MINUTES = 15

// defineTask must be called at module load time (top level), not inside an
// async function, otherwise iOS may not find the handler when the background
// task fires and will crash with "No launch handler registered".
TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  const user = whoami()
  const { showUnreadCountBadgeMobile } = getUISettings()
  if (!user || !showUnreadCountBadgeMobile) {
    return BackgroundTask.BackgroundTaskResult.Success
  }

  try {
    await unreadSyncService.refresh()
    const allUnreadCount = getUnreadAll()
    await setBadgeCountAsyncWithPermission(allUnreadCount)
    return BackgroundTask.BackgroundTaskResult.Success
  } catch (err) {
    console.error(err)
    return BackgroundTask.BackgroundTaskResult.Failed
  }
})

export async function initBackgroundTask() {
  // Registering a registered task keeps its options, and older versions asked for 900 minutes
  const registered = await TaskManager.getTaskOptionsAsync<{ minimumInterval?: number }>(
    BACKGROUND_FETCH_TASK,
  )
  if (registered && registered.minimumInterval !== MINIMUM_INTERVAL_MINUTES) {
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_FETCH_TASK)
  }
  return BackgroundTask.registerTaskAsync(BACKGROUND_FETCH_TASK, {
    minimumInterval: MINIMUM_INTERVAL_MINUTES,
  })
}
