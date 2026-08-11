import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../migrations/0073_restore_anime_season_favorite_links.sql',import.meta.url),'utf8');

describe('anime season favorite-link repair migration',()=>{
  it('restores only a saved proved member of the current root chain and preserves provenance',()=>{
    expect(sql).toContain("member.root_media_id=repairable.root_media_id");
    expect(sql).toContain("member.media_id=repairable.season_media_id");
    expect(sql).toContain("member.status='PROVED'");
    expect(sql).toContain("SET media_id=proved.season_media_id");
    expect(sql).toContain("'animeSeasonLinkRepair'");
  });

  it('is idempotent and sends missing, foreign, or incomplete season evidence to review',()=>{
    expect(sql).toContain("l.evidence->>'animeWorkRootId'=l.media_id");
    expect(sql).toContain("l.evidence->>'animeSeasonMediaId' <> l.media_id");
    expect(sql).toContain('NOT EXISTS(SELECT 1 FROM proved');
    expect(sql).toContain("'ANIME_SEASON_LINK_REPAIR_MISSING'");
    expect(sql).toContain("'ANIME_SEASON_LINK_REPAIR_UNPROVED'");
    expect(sql).not.toContain('COALESCE(member.root_media_id');
  });
});
