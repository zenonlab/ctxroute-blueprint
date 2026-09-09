import { createOrganizerConfiguration } from '@tobirink/domain';
import type { FavoriteSource, OrganizerConfiguration, OrganizerEditorialStatus, OrganizerFolder, OrganizerMediaType, OrganizerProgressState, Progress, Work } from '@tobirink/domain';
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
  return work.hydration?.candidate.mediaKind ?? (work.mediaKind === 'anime' ? 'ANIME' : 'MANGA');
}

interface OrganizerMetadataNeeds { progress: boolean; status: boolean }

function needsMetadata(folders: readonly OrganizerFolder[], parentEnabled = true): OrganizerMetadataNeeds {
  let progress = false;
  let status = false;
  for (const folder of folders) {
    const enabled = parentEnabled && folder.enabled;
    if (!enabled) continue;
    const conditions = folder.conditions;
    status ||= Boolean(conditions && conditions.editorialStatuses.length > 0);
    progress ||= Boolean(conditions && (conditions.progressStates.length > 0 || conditions.minimumStoppedProgress !== undefined));
    const children = needsMetadata(folder.children, enabled);
    status ||= children.status;
    progress ||= children.progress;
  }
  return { progress, status };
}

function editorialStatus(work: Work): OrganizerEditorialStatus | undefined {
  const status = work.hydration?.candidate.editorialStatus;
  if (status === 'ONGOING') return 'Ongoing';
  if (status === 'COMPLETED') return 'Completed';
  if (status === 'HIATUS') return 'Hiatus';
  if (status === 'CANCELLED') return 'Cancelled';
  return undefined;
}

function progressState(progress: Progress | undefined): OrganizerProgressState | undefined {
  if (progress === undefined) return undefined;
  return progress.maximum !== undefined && progress.value >= progress.maximum ? 'finished' : 'active';
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
  return storage.transaction(['favoriteSources', 'progress', 'reviews', 'works'], async (session) => {
    const { sources, truncated } = await readFavoriteSources(session);
    const contexts: OrganizerWorkContext[] = [];
    let incomplete = false;
    const required = needsMetadata(validated.folders);

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
      const status = editorialStatus(work);
      const progress = await session.findProgressByWorkId(work.id);
      const personalState = progressState(progress);
      if ((required.status && status === undefined) || (required.progress && personalState === undefined)) incomplete = true;
      const context: OrganizerWorkContext = { bookmarkId: source.bookmarkId, mediaType: mediaType(work), recognized: true };
      if (status !== undefined) Object.assign(context, { editorialStatus: status });
      if (personalState !== undefined) Object.assign(context, { progressState: personalState });
      if (progress !== undefined) Object.assign(context, { progressNumber: progress.value });
      contexts.push(context);
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
