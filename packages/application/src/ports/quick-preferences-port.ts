export interface QuickPreferences {
  nativeNotifications: boolean;
  showEstimatedReleases: boolean;
}

export interface QuickPreferencesPort {
  read(): Promise<QuickPreferences>;
  write(preferences: QuickPreferences): Promise<void>;
}

export const defaultQuickPreferences = Object.freeze<QuickPreferences>({
  nativeNotifications: false,
  showEstimatedReleases: true,
});
import { z } from 'zod';

export const quickPreferencesSchema = z.strictObject({
  nativeNotifications: z.boolean(),
  showEstimatedReleases: z.boolean(),
});
