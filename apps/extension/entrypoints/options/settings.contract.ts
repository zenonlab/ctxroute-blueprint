export const settingsVariants = ['organizer'] as const;
export const settingsStates = ['ready', 'loading', 'partial', 'offline', 'error', 'blocked'] as const;

export type SettingsVariant = (typeof settingsVariants)[number];
export type SettingsState = (typeof settingsStates)[number];
