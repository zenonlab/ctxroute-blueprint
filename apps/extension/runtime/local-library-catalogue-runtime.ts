import { readLibraryCatalogue } from '@tobirink/application';
import type { LibraryCatalogueQuery, StoragePort } from '@tobirink/application';
import type { LibraryId, ProviderEditorialStatus } from '@tobirink/domain';
import type { LibraryCatalogueRequest } from './library-catalogue-messages';

const statusLabels: Readonly<Record<ProviderEditorialStatus, string>> = Object.freeze({
  CANCELLED: 'Annulé',
  COMPLETED: 'Terminé',
  HIATUS: 'En pause',
  ONGOING: 'En cours',
  UNKNOWN: 'Statut inconnu',
  UPCOMING: 'À venir',
});

function displayText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const truncated = value.slice(0, limit);
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1);
  return finalCodeUnit >= 0xD800 && finalCodeUnit <= 0xDBFF ? truncated.slice(0, -1) : truncated;
}

function itemDetail(work: Awaited<ReturnType<StoragePort['getWork']>>): string | undefined {
  const candidate = work?.hydration?.candidate;
  if (candidate === undefined) return undefined;
  const facts = [candidate.format, candidate.startYear?.toString(), candidate.editorialStatus ? statusLabels[candidate.editorialStatus] : undefined].filter((value): value is string => value !== undefined);
  return facts.length > 0 ? displayText(facts.join(' · '), 300) : undefined;
}

export async function readLocalLibraryCatalogueSnapshot(
  storage: StoragePort,
  libraryId: LibraryId,
  input: Omit<LibraryCatalogueRequest, 'type' | 'version'>,
) {
  const query: LibraryCatalogueQuery = { libraryId, sort: input.sort };
  if (input.facets !== undefined) Object.assign(query, { facets: input.facets });
  if (input.offset !== undefined) Object.assign(query, { offset: input.offset });
  if (input.query !== undefined) Object.assign(query, { query: input.query });
  const snapshot = await readLibraryCatalogue(storage, query);
  const items = snapshot.items.map(({ progress, work }) => {
    const base = {
      id: work.id,
      mediaType: work.mediaKind,
      source: displayText(work.hydration?.candidate.provider ?? work.externalReferences[0]?.provider ?? work.mediaKind, 64),
      title: displayText(work.preferredTitle, 300),
    };
    const detail = itemDetail(work);
    const progressLabel = progress === undefined ? undefined : `${progress.value} / ${progress.maximum ?? '?'}`;
    return { ...base, detail, progress: progressLabel };
  });
  return Object.freeze({ ...snapshot, items: Object.freeze(items) });
}
