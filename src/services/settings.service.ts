import type { Settings, SettingsInput } from '@/types'

/**
 * Renderer access layer for the shop settings. The React code never touches the
 * database: every read and write goes through the preload bridge, exactly like
 * every other module.
 */
export const settingsService = {
  get: async (): Promise<Settings | null> => {
    return window.api.settings.get()
  },
  save: async (input: SettingsInput): Promise<Settings> => {
    return window.api.settings.save(input)
  },
}