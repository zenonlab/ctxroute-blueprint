import { favoritePublicCacheEntrySchema } from '@tobirink/application';
import type {
  FavoriteCollectiveKey,
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

  async searchWorksByTitle(title: string, limit: number): Promise<readonly PublicCatalogueWork[]> {
    const result = await this.database.prepare(`
      SELECT work.work_id AS id, work.media_kind AS mediaKind,
        work.preferred_title AS preferredTitle, work.revision
      FROM catalogue_works AS work
      JOIN (
        SELECT DISTINCT work_id
        FROM catalogue_titles INDEXED BY catalogue_titles_by_title
        WHERE title = ?1 COLLATE NOCASE
        ORDER BY work_id
        LIMIT ?2
      ) AS matched ON matched.work_id = work.work_id
      ORDER BY work.work_id
    `).bind(title, limit).all<PublicCatalogueWork>();
    return result.results;
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
  async findFavoriteIdentity(key: FavoriteCollectiveKey) {
    return (await this.findFavoriteIdentities([key]))[0]?.identity;
  }

  async findFavoriteIdentities(keys: readonly FavoriteCollectiveKey[]) {
    if (keys.length < 1 || keys.length > 50) throw new RangeError('Favorite cache lookup requires between 1 and 50 keys.');
    const rows = await this.database.prepare(`
      WITH requested AS (
        SELECT json_extract(value, '$.fingerprint') AS fingerprint,
          json_extract(value, '$.mediaKind') AS media_kind,
          json_extract(value, '$.parserVersion') AS parser_version,
          json_extract(value, '$.siteRulesVersion') AS rules_version
        FROM json_each(?1)
      )
      , matched AS (
        SELECT requested.fingerprint AS requestedFingerprint, cache.identity_hash AS identityHash,
          cache.media_kind AS mediaKind, cache.references_json AS referencesJson, cache.metadata_json AS metadataJson,
          ROW_NUMBER() OVER (PARTITION BY requested.fingerprint ORDER BY cache.identity_hash) AS identityRank
        FROM requested JOIN favorite_public_cache cache ON cache.fingerprint = requested.fingerprint
          AND (requested.media_kind = 'UNKNOWN' OR cache.media_kind = requested.media_kind)
          AND cache.parser_version = requested.parser_version AND cache.rules_version = requested.rules_version
        WHERE EXISTS (SELECT 1 FROM favorite_keys AS favorite_key
          JOIN favorite_confirmations confirmation ON confirmation.key_id = favorite_key.key_id
            AND confirmation.identity_hash = cache.identity_hash AND confirmation.owner_count >= 2
          WHERE favorite_key.fingerprint = cache.fingerprint
            AND (favorite_key.media_kind = cache.media_kind OR favorite_key.media_kind = 'UNKNOWN')
            AND favorite_key.parser_version = cache.parser_version AND favorite_key.rules_version = cache.rules_version)
      )
      SELECT requestedFingerprint, identityHash, mediaKind, referencesJson, metadataJson
      FROM matched WHERE identityRank <= 2 ORDER BY requestedFingerprint, identityHash
    `).bind(JSON.stringify(keys)).all<{ identityHash: string; mediaKind: string; metadataJson: string; referencesJson: string; requestedFingerprint: string }>();
    return keys.map((key) => {
      const matches = rows.results.filter((row) => row.requestedFingerprint === key.fingerprint);
      if (matches.length !== 1) return { fingerprint: key.fingerprint };
      const row = matches[0];
      try { return { fingerprint: key.fingerprint, identity: favoritePublicCacheEntrySchema.parse({ mediaKind: row?.mediaKind, metadata: JSON.parse(row?.metadataJson ?? 'null'), references: JSON.parse(row?.referencesJson ?? 'null') }) }; }
      catch { return { fingerprint: key.fingerprint }; }
    });
  }
}
