export interface QuickPreferences {
  nativeNotifications: boolean;
  showEstimatedReleases: boolean;
  showAdultContent: boolean;
}

export interface QuickPreferencesPort {
  read(): Promise<QuickPreferences>;
  write(preferences: QuickPreferences): Promise<void>;
}

export const defaultQuickPreferences = Object.freeze<QuickPreferences>({
  nativeNotifications: false,
  showEstimatedReleases: true,
  showAdultContent: false,
});
import { z } from 'zod';

export const quickPreferencesSchema = z.strictObject({
  nativeNotifications: z.boolean(),
  showEstimatedReleases: z.boolean(),
  showAdultContent: z.boolean(),
});
