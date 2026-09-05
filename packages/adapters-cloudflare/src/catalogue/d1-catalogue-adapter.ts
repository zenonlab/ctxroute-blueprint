import type {
  PublicCatalogueReadPort,
  PublicCatalogueReference,
  PublicCatalogueTitle,
  PublicCatalogueWork,
} from '@tobirink/application';

type SqlValue = null | number | string;

interface BoundD1PreparedStatement {
  all<TResult>(): Promise<{ results: TResult[] }>;
  bind(...values: SqlValue[]): BoundD1PreparedStatement;
  first<TResult>(): Promise<TResult | null>;
}

export interface CatalogueD1Database {
  prepare(query: string): BoundD1PreparedStatement;
}

export class D1PublicCatalogueAdapter implements PublicCatalogueReadPort {
  constructor(private readonly database: CatalogueD1Database) {}

  async listWorksAfter(cursor: { id: string; revision: number }, limit: number): Promise<readonly PublicCatalogueWork[]> {
    const result = await this.database.prepare(`
      SELECT work_id AS id, media_kind AS mediaKind, preferred_title AS preferredTitle, revision
      FROM catalogue_works
      WHERE (revision, work_id) > (?1, ?2)
      ORDER BY revision, work_id
      LIMIT ?3
    `).bind(cursor.revision, cursor.id, limit).all<PublicCatalogueWork>();
    return result.results;
  }

  async findWork(workId: string): Promise<PublicCatalogueWork | undefined> {
    const work = await this.database.prepare(`
      SELECT work_id AS id, media_kind AS mediaKind, preferred_title AS preferredTitle, revision
      FROM catalogue_works
      WHERE work_id = ?1
      LIMIT 1
    `).bind(workId).first<PublicCatalogueWork>();
    return work ?? undefined;
  }

  async resolveReference(provider: string, externalId: string): Promise<PublicCatalogueWork | undefined> {
    const work = await this.database.prepare(`
      SELECT work.work_id AS id, work.media_kind AS mediaKind,
        work.preferred_title AS preferredTitle, work.revision
      FROM catalogue_external_references AS reference
      JOIN catalogue_works AS work ON work.work_id = reference.work_id
      WHERE reference.provider = ?1 AND reference.external_id = ?2
      LIMIT 1
    `).bind(provider, externalId).first<PublicCatalogueWork>();
    return work ?? undefined;
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
