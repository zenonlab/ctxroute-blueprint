import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {repairMissingPositionsRequestContract} from '@favlib/contracts';

describe('missing position repair contract',()=>{
  it('bounds grouped visible media to thirty',()=>{
    const item=(index:number)=>({mediaId:`synthetic:${index}`,missing:['personal'] as const});
    expect(repairMissingPositionsRequestContract.safeParse({items:Array.from({length:30},(_,i)=>item(i))}).success).toBe(true);
    expect(repairMissingPositionsRequestContract.safeParse({items:Array.from({length:31},(_,i)=>item(i))}).success).toBe(false);
  });
  it('enforces ownership, ignores removed favorites, versions no-evidence parsing and queues identities directly',()=>{
    const source=readFileSync(resolve(process.cwd(),'src/server.ts'),'utf8');
    expect(source).toContain('l.user_id=$2');
    expect(source).toContain("i.event<>'removed'");
    expect(source).toMatch(/progress_parser_version\s*===\s*FAVORITE_PROGRESS_PARSER_VERSION/u);
    expect(source).toContain("progress_parse_status=$2");
    expect(source).toMatch(/provider\s*=\s*owned\.rows\[0\]\.type\s*===\s*["']ANIME["']\s*\?\s*["']anilist["']\s*:\s*["']mangaupdates["']/u);
    expect(source).toContain('repair-availability:${provider}:${refreshMediaId}');
    expect(source).toContain('ORDER BY member_order DESC LIMIT 1');
    expect(source).not.toContain('repairPopularity');
  });
  it('backfills active resolved favorites through the same parser and materializer',()=>{
    const source=readFileSync(resolve(process.cwd(),'src/backfill-favorite-progress.ts'),'utf8');
    expect(source).toContain('progressionFromFavorite');
    expect(source).toContain("i.event<>'removed'");
    expect(source).toContain("l.status IN ('matched','accepted')");
    expect(source).toContain('position_number=excluded.position_number');
    expect(source).toContain('position_raw=excluded.position_raw');
    expect(source).not.toContain('position_number=GREATEST');
    expect(source).toContain('DELETE FROM favorite_progress_candidate');
    expect(source).toContain('SET status=status');
    expect(source).toContain('FAVORITE_PROGRESS_PARSER_VERSION');
  });
});
