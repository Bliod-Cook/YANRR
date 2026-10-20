import { useRegisterEntryCommands } from "./commands/entry"
import { useRegisterEntryRenderCommand } from "./commands/entry-render"
import { useRegisterGlobalCommands } from "./commands/global"
import { useRegisterIntegrationCommands } from "./commands/integration"
import { useRegisterLayoutCommands } from "./commands/layout"
import { useRegisterSettingsCommands } from "./commands/settings"
import { useRegisterSubscriptionCommands } from "./commands/subscription"
import { useRegisterTimelineCommand } from "./commands/timeline"

export const FollowCommandManager = () => {
  useRegisterSettingsCommands()
  useRegisterEntryCommands()
  useRegisterIntegrationCommands()
  useRegisterGlobalCommands()
  useRegisterLayoutCommands()
  useRegisterTimelineCommand()
  useRegisterEntryRenderCommand()
  useRegisterSubscriptionCommands()
  return null
}
