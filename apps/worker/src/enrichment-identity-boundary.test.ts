import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

describe('resolved identity enrichment boundary',()=>{
  it('refreshes MangaUpdates by stored ID without title discovery',()=>{
    const source=readFileSync(new URL('./tasks/mangaupdates-enrichment.ts',import.meta.url),'utf8');
    expect(source).toContain('selected = record;');
    expect(source).toContain('fastPath = true;');
    expect(source).toContain('for (const q of fastPath ? [] : queries)');
  });
  it('refreshes AniList by stored ID without title discovery',()=>{
    const source=readFileSync(new URL('./tasks/anilist-enrichment.ts',import.meta.url),'utf8');
    expect(source).toContain('selectedResolutionCode = "KNOWN_EXTERNAL_ID"');
    expect(source).toContain('!selected && variantIndex < pendingVariants.length');
  });
});
