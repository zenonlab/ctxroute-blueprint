import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../migrations/0037_materialize_proved_favorite_progress.sql',import.meta.url),'utf8');
const parserState=readFileSync(new URL('../migrations/0038_bookmark_progress_parser_state.sql',import.meta.url),'utf8');

describe('proved favorite progress backfill',()=>{
  it('reuses the materialization trigger only for active owned links with evidence',()=>{
    expect(sql).toContain("link.status IN ('matched', 'accepted')");
    expect(sql).toContain("item.event <> 'removed'");
    expect(sql).toContain('candidate.user_id = link.user_id');
    expect(sql).toContain('candidate.installation_id = link.installation_id');
    expect(sql).toContain('candidate.bookmark_id = link.bookmark_id');
    expect(sql).toContain('SET status = link.status');
  });
  it('repairs parser state independently from already-recorded migrations',()=>{
    expect(parserState).toContain('ADD COLUMN IF NOT EXISTS progress_parser_version');
    expect(parserState).toContain('ADD COLUMN IF NOT EXISTS progress_parser_fingerprint');
    expect(parserState).toContain("progress_parse_status IN ('evidence','no_evidence')");
  });
});
