import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration=readFileSync(new URL('../migrations/0064_personal_adult_visibility_and_mangaupdates_type.sql',import.meta.url),'utf8');

describe('personal adult visibility migration',()=>{
  it('defaults every independent user preference to false and centralizes the media/user decision',()=>{
    expect(migration).toContain('allow_adult boolean NOT NULL DEFAULT false');
    expect(migration).toContain('favlib_content_allowed(input_media_id text,input_user_id uuid)');
    expect(migration).toContain('preference.user_id=input_user_id');
    expect(migration).toContain('favlib_recalculate_user_content_visibility(input_user_id uuid)');
  });

  it('keeps the exact taxonomy while allowing mature, ecchi and partial labels',()=>{
    expect(migration).toContain("ARRAY['adult','erotica','hentai','smut']");
    expect(migration).not.toMatch(/ARRAY\[[^\]]*'mature'/u);
    expect(migration).not.toMatch(/ARRAY\[[^\]]*'ecchi'/u);
    expect(migration).not.toContain("LIKE '%adult%'");
  });

  it('reopens only automatic technical exclusions and preserves personal data',()=>{
    expect(migration).toContain("decision->>'kind'='content-excluded'");
    expect(migration).toContain("reason='BLOCKED_CONTENT_TAXONOMY'");
    expect(migration).not.toContain('DELETE FROM bookmark_import_item');
    expect(migration).not.toContain('DELETE FROM favorite_progress');
    expect(migration).not.toContain("decision->>'kind'='manual'");
  });

  it('backfills MangaUpdates types from retained raw evidence and queues missing proof',()=>{
    expect(migration).toContain("WHEN 'manhwa' THEN 'MANHWA'");
    expect(migration).toContain("WHEN 'manhua' THEN 'MANHUA'");
    expect(migration).toContain("profile.provider='mangaupdates'");
    expect(migration).toContain("'mangaupdates-type-backfill:'||media.id");
    expect(migration).not.toContain('DELETE FROM provider_payload');
  });
});
