export const WORKER_TASK_NAMES = [
  'availability', 'availability-sweep', 'announcement-sync', 'backup', 'cover-recompress',
  'health', 'notification-delivery', 'retention-purge', 'resolve-favorite', 'source-resolve:v2',
  'anilist-enrichment', 'mangaupdates-enrichment', 'enrichment-sweep', 'mangaupdates-release-sweep', 'anilist-calendar-sweep',
  'provider-profile-cover', 'manual-review-provider', 'reassess-favorite-reviews',
  'mangadex-promotion',
] as const;

export const SCHEDULES = {
  'availability-sweep': 5 * 60_000, 'enrichment-sweep': 10 * 60_000,
  'mangaupdates-release-sweep': 5 * 60_000, 'anilist-calendar-sweep': 5 * 60_000,
  'mangadex-promotion': 10 * 60_000,
  'notification-delivery': 5 * 60_000, health: 2 * 60_000, 'retention-purge': 24 * 60 * 60_000,
} as const;

export const ROLE_SCHEDULES = {
  all: {
    'notification-delivery': SCHEDULES['notification-delivery'],
    'retention-purge': SCHEDULES['retention-purge'],
  },
  reading: {
    'availability-sweep': SCHEDULES['availability-sweep'],
    'enrichment-sweep': SCHEDULES['enrichment-sweep'],
    'mangaupdates-release-sweep': SCHEDULES['mangaupdates-release-sweep'],
    'anilist-calendar-sweep': SCHEDULES['anilist-calendar-sweep'],
    'mangadex-promotion': SCHEDULES['mangadex-promotion'],
  },
  interactive: {},
} as const;

export const ROLE_TASK_NAMES = {
  all: ['availability','announcement-sync','backup','cover-recompress','health','notification-delivery','retention-purge','resolve-favorite','source-resolve:v2'],
  reading: ['availability','availability-sweep','health','notification-delivery','anilist-enrichment','mangaupdates-enrichment','enrichment-sweep','mangaupdates-release-sweep','anilist-calendar-sweep','mangadex-promotion','provider-profile-cover','reassess-favorite-reviews'],
  interactive: ['manual-review-provider'],
} as const;

export function parseCrontab(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => line.split(/\s+/).slice(5).join(' '));
}
