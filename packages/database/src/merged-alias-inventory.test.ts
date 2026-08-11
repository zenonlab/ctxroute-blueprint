import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const migration=readFileSync(new URL('../migrations/0062_hide_merged_alias_inventory.sql',import.meta.url),'utf8');
const bootstrap=readFileSync(new URL('../bootstrap/anilist.sql',import.meta.url),'utf8');

describe('merged alias inventory cleanup',()=>{
  it('keeps one auditable technical relation pointing at the current merge target',()=>{
    expect(migration).toContain("relation.kind='canonical_variant'");
    expect(migration).toContain('relation.target_media_id<>merge.target_media_id');
    expect(migration).toContain("SELECT source_media_id,target_media_id,'canonical_variant',evidence");
    expect(migration).not.toContain('DELETE FROM media_identity_merge');
  });

  it('makes repeated merges replace stale technical targets without losing provenance',()=>{
    const fn=bootstrap.slice(bootstrap.indexOf('CREATE OR REPLACE FUNCTION merge_media_identity'),bootstrap.indexOf('CREATE OR REPLACE FUNCTION favlib_clean_display_title'));
    expect(fn).toContain("kind='canonical_variant' AND target_media_id<>target_id");
    expect(fn).toContain('ON CONFLICT(media_id,target_media_id,kind) DO UPDATE SET provenance=excluded.provenance');
  });

  it('removes only active links whose retained raw import is explicitly removed',()=>{
    expect(migration).toContain("item.event='removed'");
    expect(migration).toContain("link.status IN ('matched','accepted','review')");
    expect(migration).toContain("SET status='removed'");
    expect(migration).not.toContain('DELETE FROM bookmark_import_item');
    expect(migration).not.toContain('DELETE FROM favorite_review');
  });
  it('creates catalogue preferences before extending their synthetic bootstrap schema',()=>{
    expect(bootstrap.indexOf('CREATE TABLE IF NOT EXISTS user_catalog_preference')).toBeLessThan(bootstrap.indexOf("ALTER TABLE user_catalog_preference ADD COLUMN IF NOT EXISTS preferred_languages"));
  });
});
