import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const migration=readFileSync(new URL('../migrations/0039_global_anime_works.sql',import.meta.url),'utf8');
const worker=readFileSync(new URL('../../../apps/worker/src/tasks/anime-work.ts',import.meta.url),'utf8');
const enrichment=readFileSync(new URL('../../../apps/worker/src/tasks/anilist-enrichment.ts',import.meta.url),'utf8');

describe('global anime work persistence contract',()=>{
  it('uses a deterministic observation key and no parallel review queue',()=>{
    expect(migration).toContain('progression_observation_materialization_key_unique');
    expect(worker).toContain('ON CONFLICT(materialization_key)');
    expect(migration).not.toContain('CREATE TABLE anime_work_review');
    expect(worker).toContain("'ANIME_CHAIN_AMBIGUOUS'");
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS favorite_review_reason_check');
    expect(migration).not.toContain('CHECK (reason IS NULL');
    expect(migration).not.toContain('ADD COLUMN review_reason');
  });

  it('runs production reconciliation on one PostgreSQL client transaction',()=>{
    expect(worker).toContain("await client.query('BEGIN')");
    expect(worker).toContain("await client.query('ROLLBACK')");
    expect(worker).toContain('h.withPgClient');
  });

  it('keeps season media identities independent',()=>{
    expect(worker).not.toContain('merge_media_identity');
    expect(worker).not.toContain('UPDATE bookmark_media_link l SET media_id=$1');
    expect(worker).toContain('A bookmark remains attached to the resolved AniList season');
    expect(enrichment).toContain('ANILIST_IDENTITY_CONFLICT');
    expect(enrichment).toContain("String(sourceIdentity.rows[0].external_id) !== String(m.id)");
  });

  it('does not mutate personal links as part of the schema migration',()=>{
    const migration=readFileSync(new URL('../migrations/0073_restore_anime_season_favorite_links.sql',import.meta.url),'utf8');
    expect(migration).not.toContain('UPDATE bookmark_media_link');
    expect(migration).toContain('Schema-only migration');
  });

  it('enriches related anime formats without adding them to numeric progression',()=>{
    expect(worker).toContain("const allowed=new Set(['TV','TV_SHORT','ONA'])");
    expect(worker).toContain('anilist-relation:${CONNECTOR_VERSIONS.anilistMetadata}:${relation.id}');
    expect(worker).not.toContain('animeRelatedExtra:true');
  });

  it('keeps an ambiguous choice in an immutable personal projection',()=>{
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS user_anime_work_choice');
    expect(migration).toContain('PRIMARY KEY(user_id,seed_media_id)');
    expect(migration).toContain('review_id uuid NOT NULL UNIQUE');
  });
});
