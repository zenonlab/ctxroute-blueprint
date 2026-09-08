import { createOrganizerConfiguration } from '@tobirink/domain';
import type { FavoriteSource, OrganizerConfiguration, OrganizerFolder, OrganizerMediaType, Work } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';
import { buildOrganizerPreview } from './build-organizer-preview';
import type { OrganizerPreviewItem, OrganizerWorkContext } from './build-organizer-preview';

export const organizerPreviewLimit = 500;
const organizerPageSize = 100;

export interface OrganizerPreviewSnapshot {
  readonly inspectedCount: number;
  readonly items: readonly OrganizerPreviewItem[];
  readonly state: 'partial' | 'ready';
  readonly truncated: boolean;
}

function mediaType(work: Work): OrganizerMediaType {
  return work.mediaKind === 'anime' ? 'ANIME' : 'MANGA';
}

function needsUnavailableMetadata(folders: readonly OrganizerFolder[]): boolean {
  return folders.some((folder) => {
    const conditions = folder.conditions;
    return Boolean(conditions && (
      conditions.editorialStatuses.length > 0
      || conditions.progressStates.length > 0
      || conditions.minimumStoppedProgress !== undefined
    )) || needsUnavailableMetadata(folder.children);
  });
}

async function readFavoriteSources(storage: Pick<StoragePort, 'listFavoriteSources'>): Promise<{ sources: readonly FavoriteSource[]; truncated: boolean }> {
  const sources: FavoriteSource[] = [];
  let afterId: FavoriteSource['id'] | undefined;
  let inspected = 0;

  while (inspected < organizerPreviewLimit) {
    const limit = Math.min(organizerPageSize, organizerPreviewLimit - inspected);
    const page = await storage.listFavoriteSources(afterId === undefined
      ? { limit }
      : { afterId, limit });
    inspected += page.length;
    sources.push(...page.filter((source) => source.presence === 'observed'));
    if (page.length < limit) return { sources, truncated: false };
    afterId = page.at(-1)?.id;
    if (afterId === undefined) return { sources, truncated: false };
  }
  return { sources, truncated: true };
}

export async function saveOrganizerConfiguration(
  storage: StoragePort,
  configuration: OrganizerConfiguration,
): Promise<OrganizerConfiguration> {
  const validated = createOrganizerConfiguration(configuration);
  await storage.transaction(['organizer'], async (session) => session.putOrganizerConfiguration(validated));
  return validated;
}

export async function readOrganizerPreview(
  storage: StoragePort,
  configuration: OrganizerConfiguration,
): Promise<OrganizerPreviewSnapshot> {
  const validated = createOrganizerConfiguration(configuration);
  return storage.transaction(['favoriteSources', 'reviews', 'works'], async (session) => {
    const { sources, truncated } = await readFavoriteSources(session);
    const contexts: OrganizerWorkContext[] = [];
    let incomplete = needsUnavailableMetadata(validated.folders);

    for (const source of sources) {
      const review = source.reviewId === undefined ? undefined : await session.getReview(source.reviewId);
      const matchedWorkId = source.matchedWorkId ?? review?.matchedWorkId;
      if (matchedWorkId === undefined) {
        incomplete = true;
        contexts.push({ bookmarkId: source.bookmarkId, recognized: false });
        continue;
      }
      const work = await session.getWork(matchedWorkId);
      if (work === undefined) {
        incomplete = true;
        contexts.push({ bookmarkId: source.bookmarkId, recognized: false });
        continue;
      }
      contexts.push({ bookmarkId: source.bookmarkId, mediaType: mediaType(work), recognized: true });
    }

    return Object.freeze({
      inspectedCount: sources.length,
      items: buildOrganizerPreview(validated.folders, sources.map((source) => ({
        bookmarkId: source.bookmarkId,
        currentFolderPath: source.folderPath,
        title: source.title,
      })), contexts),
      state: incomplete || truncated ? 'partial' : 'ready',
      truncated,
    });
  });
}
