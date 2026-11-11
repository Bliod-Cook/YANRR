import { createSettingAtom } from "@follow/atoms/helper/setting.js"
import { defaultAISettings } from "@follow/shared/settings/defaults"
import type {
  AISettings,
  AIShortcut,
  AIShortcutTarget,
  MCPService,
} from "@follow/shared/settings/interface"
import { DEFAULT_SHORTCUT_TARGETS } from "@follow/shared/settings/interface"
import { jotaiStore } from "@follow/utils"
import { clamp } from "es-toolkit"
import { atom, useAtomValue } from "jotai"

import { getFeature } from "~/hooks/biz/useFeature"

export interface WebAISettings extends AISettings {
  panelStyle: AIChatPanelStyle
  showSplineButton: boolean
}

const VALID_SHORTCUT_TARGETS = new Set<AIShortcutTarget>(DEFAULT_SHORTCUT_TARGETS)

const isValidShortcutTarget = (target: string): target is AIShortcutTarget =>
  VALID_SHORTCUT_TARGETS.has(target as AIShortcutTarget)

const sanitizeShortcutTargets = (targets?: readonly string[]): AIShortcutTarget[] => {
  if (!targets || targets.length === 0) {
    return [...DEFAULT_SHORTCUT_TARGETS]
  }

  const filtered = targets.filter(isValidShortcutTarget) as AIShortcutTarget[]
  return filtered.length > 0 ? [...filtered] : [...DEFAULT_SHORTCUT_TARGETS]
}

const normalizeShortcut = (shortcut: AIShortcut): AIShortcut => {
  return {
    ...shortcut,
    displayTargets: sanitizeShortcutTargets(shortcut.displayTargets),
    enabled: typeof shortcut.enabled === "boolean" ? shortcut.enabled : true,
  }
}

const normalizeShortcuts = (shortcuts: readonly AIShortcut[] | undefined): AIShortcut[] =>
  (shortcuts ?? []).map((shortcut) => normalizeShortcut({ ...shortcut }))

export const getShortcutEffectivePrompt = (shortcut: AIShortcut): string => {
  return shortcut.prompt || shortcut.defaultPrompt || ""
}

export const isServerShortcut = (shortcut: AIShortcut) => !!shortcut.defaultPrompt

export const createDefaultSettings = (): WebAISettings => ({
  ...defaultAISettings,
  shortcuts: normalizeShortcuts(defaultAISettings.shortcuts),
  panelStyle: AIChatPanelStyle.Floating,
  showSplineButton: true,
})

export const {
  useSettingKey: useAISettingKey,
  useSettingSelector: useAISettingSelector,
  setSetting: setAISetting,
  initializeDefaultSettings,
  getSettings: getAISettings,
  useSettingValue: useAISettingValue,
  settingAtom: __aiSettingAtom,
} = createSettingAtom("ai", createDefaultSettings)
/** Device-local AI settings: every other AI setting syncs to the account. */
export const aiLocalOnlyKeys: (keyof AISettings)[] = []

////////// AI Panel Style
export enum AIChatPanelStyle {
  Fixed = "fixed",
  Floating = "floating",
}

export const useAIChatPanelStyle = () => useAISettingKey("panelStyle")
export const setAIChatPanelStyle = (style: AIChatPanelStyle) => {
  setAISetting("panelStyle", style)
}
export const getAIChatPanelStyle = () => getAISettings().panelStyle

// Floating panel state atoms
interface FloatingPanelState {
  width: number
  height: number
  x: number
  y: number
}

const DEFAULT_FLOATING_PANEL_WIDTH = 500
const DEFAULT_FLOATING_PANEL_HEIGHT = clamp(window.innerHeight * 0.9, 600, 1000)
const DEFAULT_FLOATING_PANEL_X = window.innerWidth - DEFAULT_FLOATING_PANEL_WIDTH - 20
const DEFAULT_FLOATING_PANEL_Y = window.innerHeight - DEFAULT_FLOATING_PANEL_HEIGHT - 20

const defaultFloatingPanelState: FloatingPanelState = {
  width: DEFAULT_FLOATING_PANEL_WIDTH,
  height: DEFAULT_FLOATING_PANEL_HEIGHT,
  x: DEFAULT_FLOATING_PANEL_X,
  y: DEFAULT_FLOATING_PANEL_Y,
}

const floatingPanelStateAtom = atom<FloatingPanelState>(defaultFloatingPanelState)

export const useFloatingPanelState = () => useAtomValue(floatingPanelStateAtom)
export const setFloatingPanelState = (state: Partial<FloatingPanelState>) => {
  const currentState = jotaiStore.get(floatingPanelStateAtom)
  jotaiStore.set(floatingPanelStateAtom, { ...currentState, ...state })
}
export const getFloatingPanelState = () => jotaiStore.get(floatingPanelStateAtom)

////////// AI Panel Visibility

const aiPanelVisibilityAtom = atom<boolean>(false)
export const useAIPanelVisibility = () => useAtomValue(aiPanelVisibilityAtom)
export const setAIPanelVisibility = (visibility: boolean) => {
  const aiEnabled = getFeature("ai")
  if (aiEnabled) {
    jotaiStore.set(aiPanelVisibilityAtom, visibility)
  }
}
export const getAIPanelVisibility = () => jotaiStore.get(aiPanelVisibilityAtom)

////////// MCP Services
export const useMCPEnabled = () => useAISettingKey("mcpEnabled")
export const setMCPEnabled = (enabled: boolean) => {
  setAISetting("mcpEnabled", enabled)
}

export const useMCPServices = () => useAISettingKey("mcpServices")
export const addMCPService = (service: Omit<MCPService, "id">) => {
  const services = getAISettings().mcpServices
  const newService = {
    ...service,
    id: Date.now().toString(),
  }
  setAISetting("mcpServices", [...services, newService])
  return newService.id
}

export const updateMCPService = (id: string, updates: Partial<MCPService>) => {
  const services = getAISettings().mcpServices
  const updatedServices = services.map((service) =>
    service.id === id ? { ...service, ...updates } : service,
  )
  setAISetting("mcpServices", updatedServices)
}

export const removeMCPService = (id: string) => {
  const services = getAISettings().mcpServices
  const filteredServices = services.filter((service) => service.id !== id)
  setAISetting("mcpServices", filteredServices)
}

//// Enhance Init Ai Settings
export const initializeDefaultAISettings = () => {
  initializeDefaultSettings()
}
