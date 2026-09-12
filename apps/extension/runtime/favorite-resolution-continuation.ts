export const favoriteResolutionContinuationAlarmName = 'tobirink-favorite-resolution-continuation-v1';
export const favoriteResolutionContinuationDelayMinutes = 0.5;

export interface FavoriteResolutionAlarmPort {
  create(name: string, alarmInfo: { delayInMinutes: number }): Promise<void> | void;
}

export async function scheduleFavoriteResolutionContinuation(alarms: FavoriteResolutionAlarmPort): Promise<void> {
  await alarms.create(favoriteResolutionContinuationAlarmName, { delayInMinutes: favoriteResolutionContinuationDelayMinutes });
}
