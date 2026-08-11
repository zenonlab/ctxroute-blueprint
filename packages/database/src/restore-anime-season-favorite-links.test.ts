import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../migrations/0073_restore_anime_season_favorite_links.sql',import.meta.url),'utf8');

describe('anime season favorite-link repair migration',()=>{
  it('keeps deployment schema-only and requires an explicit operator repair',()=>{
    expect(sql).toContain('Schema-only migration');
    expect(sql).toContain('repair-anime-season-links');
    expect(sql).toContain('preview is the default');
    expect(sql).not.toContain('UPDATE bookmark_media_link');
    expect(sql).not.toContain('INSERT INTO favorite_review');
  });
});
