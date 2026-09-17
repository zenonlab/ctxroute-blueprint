import type {
  PublicCatalogueReadPort,
  PublicCatalogueReference,
  PublicCatalogueTitle,
  PublicCatalogueWork,
} from '@tobirink/application';
import { z } from 'zod';

type SqlValue = null | number | string;

interface BoundD1PreparedStatement {
  all<TResult>(): Promise<{ results: TResult[] }>;
  bind(...values: SqlValue[]): BoundD1PreparedStatement;
  first<TResult>(): Promise<TResult | null>;
}

export interface CatalogueD1Database {
  prepare(query: string): BoundD1PreparedStatement;
}

interface CatalogueWorkRow extends PublicCatalogueWork {
  categoriesJson: string | null;
  chapterTotal: number | null;
  contentClassification: 'adult' | 'non-adult' | 'unknown' | null;
  coverAttribution: string | null;
  coverUrl: string | null;
  editorialStatus: Exclude<NonNullable<PublicCatalogueWork['metadata']>['editorialStatus'], undefined> | null;
  endYear: number | null;
  episodeTotal: number | null;
  format: string | null;
  genresJson: string | null;
  sourceExternalId: string | null;
  sourceObservedAt: string | null;
  sourceProvider: string | null;
  sourceVersion: number | null;
  startYear: number | null;
  volumeTotal: number | null;
}

const stringListSchema = z.array(z.string());

function workFromRow(row: CatalogueWorkRow): PublicCatalogueWork {
  const result: PublicCatalogueWork = { id: row.id, mediaKind: row.mediaKind, preferredTitle: row.preferredTitle, revision: row.revision };
  if (row.sourceProvider === null || row.sourceExternalId === null || row.sourceObservedAt === null || row.sourceVersion === null) return result;
  const parseStrings = (json: string | null): string[] => stringListSchema.parse(JSON.parse(json ?? '[]'));
  const metadata: NonNullable<PublicCatalogueWork['metadata']> = {
    categories: parseStrings(row.categoriesJson),
    contentClassification: row.contentClassification ?? 'unknown',
    genres: parseStrings(row.genresJson),
    source: { externalId: row.sourceExternalId, observedAt: row.sourceObservedAt, provider: row.sourceProvider, version: row.sourceVersion },
  };
  if (row.chapterTotal !== null) metadata.chapterTotal = row.chapterTotal;
  if (row.coverAttribution !== null && row.coverUrl !== null) metadata.cover = { attribution: row.coverAttribution, url: row.coverUrl };
  if (row.editorialStatus !== null) metadata.editorialStatus = row.editorialStatus;
  if (row.endYear !== null) metadata.endYear = row.endYear;
  if (row.episodeTotal !== null) metadata.episodeTotal = row.episodeTotal;
  if (row.format !== null) metadata.format = row.format;
  if (row.startYear !== null) metadata.startYear = row.startYear;
  if (row.volumeTotal !== null) metadata.volumeTotal = row.volumeTotal;
  result.metadata = metadata;
  return result;
}

export class D1PublicCatalogueAdapter implements PublicCatalogueReadPort {
  constructor(private readonly database: CatalogueD1Database) {}

  async listWorksAfter(cursor: { id: string; revision: number }, limit: number): Promise<readonly PublicCatalogueWork[]> {
    const result = await this.database.prepare(`
      SELECT work.work_id AS id, work.media_kind AS mediaKind, work.preferred_title AS preferredTitle,
        work.revision, metadata.editorial_status AS editorialStatus, metadata.format,
        metadata.start_year AS startYear, metadata.end_year AS endYear,
        metadata.episode_total AS episodeTotal, metadata.chapter_total AS chapterTotal,
        metadata.volume_total AS volumeTotal, metadata.cover_url AS coverUrl,
        metadata.cover_attribution AS coverAttribution, metadata.genres_json AS genresJson,
        metadata.categories_json AS categoriesJson, metadata.content_classification AS contentClassification,
        metadata.source_provider AS sourceProvider, metadata.source_external_id AS sourceExternalId,
        metadata.value_observed_at AS sourceObservedAt, metadata.normalization_version AS sourceVersion
      FROM catalogue_works AS work
      LEFT JOIN catalogue_current_metadata AS metadata ON metadata.work_id = work.work_id
      WHERE (work.revision, work.work_id) > (?1, ?2)
      ORDER BY work.revision, work.work_id
      LIMIT ?3
    `).bind(cursor.revision, cursor.id, limit).all<CatalogueWorkRow>();
    return result.results.map(workFromRow);
  }

  async findWork(workId: string): Promise<PublicCatalogueWork | undefined> {
    const work = await this.database.prepare(`
      SELECT work.work_id AS id, work.media_kind AS mediaKind, work.preferred_title AS preferredTitle,
        work.revision, metadata.editorial_status AS editorialStatus, metadata.format,
        metadata.start_year AS startYear, metadata.end_year AS endYear,
        metadata.episode_total AS episodeTotal, metadata.chapter_total AS chapterTotal,
        metadata.volume_total AS volumeTotal, metadata.cover_url AS coverUrl,
        metadata.cover_attribution AS coverAttribution, metadata.genres_json AS genresJson,
        metadata.categories_json AS categoriesJson, metadata.content_classification AS contentClassification,
        metadata.source_provider AS sourceProvider, metadata.source_external_id AS sourceExternalId,
        metadata.value_observed_at AS sourceObservedAt, metadata.normalization_version AS sourceVersion
      FROM catalogue_works AS work
      LEFT JOIN catalogue_current_metadata AS metadata ON metadata.work_id = work.work_id
      WHERE work.work_id = ?1
      LIMIT 1
    `).bind(workId).first<CatalogueWorkRow>();
    return work === null ? undefined : workFromRow(work);
  }

  async resolveReference(provider: string, externalId: string): Promise<PublicCatalogueWork | undefined> {
    const work = await this.database.prepare(`
      SELECT work.work_id AS id, work.media_kind AS mediaKind,
        work.preferred_title AS preferredTitle, work.revision,
        metadata.editorial_status AS editorialStatus, metadata.format,
        metadata.start_year AS startYear, metadata.end_year AS endYear,
        metadata.episode_total AS episodeTotal, metadata.chapter_total AS chapterTotal,
        metadata.volume_total AS volumeTotal, metadata.cover_url AS coverUrl,
        metadata.cover_attribution AS coverAttribution, metadata.genres_json AS genresJson,
        metadata.categories_json AS categoriesJson, metadata.content_classification AS contentClassification,
        metadata.source_provider AS sourceProvider, metadata.source_external_id AS sourceExternalId,
        metadata.value_observed_at AS sourceObservedAt, metadata.normalization_version AS sourceVersion
      FROM catalogue_external_references AS reference
      JOIN catalogue_works AS work ON work.work_id = reference.work_id
      LEFT JOIN catalogue_current_metadata AS metadata ON metadata.work_id = work.work_id
      WHERE reference.provider = ?1 AND reference.external_id = ?2
      LIMIT 1
    `).bind(provider, externalId).first<CatalogueWorkRow>();
    return work === null ? undefined : workFromRow(work);
  }

  async searchWorksByTitle(title: string, limit: number): Promise<readonly PublicCatalogueWork[]> {
    const result = await this.database.prepare(`
      SELECT work.work_id AS id, work.media_kind AS mediaKind,
        work.preferred_title AS preferredTitle, work.revision,
        metadata.editorial_status AS editorialStatus, metadata.format,
        metadata.start_year AS startYear, metadata.end_year AS endYear,
        metadata.episode_total AS episodeTotal, metadata.chapter_total AS chapterTotal,
        metadata.volume_total AS volumeTotal, metadata.cover_url AS coverUrl,
        metadata.cover_attribution AS coverAttribution, metadata.genres_json AS genresJson,
        metadata.categories_json AS categoriesJson, metadata.content_classification AS contentClassification,
        metadata.source_provider AS sourceProvider, metadata.source_external_id AS sourceExternalId,
        metadata.value_observed_at AS sourceObservedAt, metadata.normalization_version AS sourceVersion
      FROM catalogue_works AS work
      LEFT JOIN catalogue_current_metadata AS metadata ON metadata.work_id = work.work_id
      JOIN (
        SELECT DISTINCT work_id
        FROM catalogue_titles INDEXED BY catalogue_titles_by_title
        WHERE title = ?1 COLLATE NOCASE
        ORDER BY work_id
        LIMIT ?2
      ) AS matched ON matched.work_id = work.work_id
      ORDER BY work.work_id
    `).bind(title, limit).all<CatalogueWorkRow>();
    return result.results.map(workFromRow);
  }

  async listTitles(workId: string, limit: number): Promise<readonly PublicCatalogueTitle[]> {
    const result = await this.database.prepare(`
      SELECT locale, title FROM catalogue_titles
      WHERE work_id = ?1 ORDER BY locale, title LIMIT ?2
    `).bind(workId, limit).all<PublicCatalogueTitle>();
    return result.results;
  }

  async listReferences(workId: string, limit: number): Promise<readonly PublicCatalogueReference[]> {
    const result = await this.database.prepare(`
      SELECT provider, external_id AS externalId FROM catalogue_external_references
      WHERE work_id = ?1 ORDER BY provider, external_id LIMIT ?2
    `).bind(workId, limit).all<PublicCatalogueReference>();
    return result.results;
  }
}
