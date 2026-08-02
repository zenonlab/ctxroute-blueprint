import { describe, expect, it } from 'vitest';
import { chunks, code, fingerprint, isMedia } from './core.js';
describe('extension bookmark privacy primitives',()=>{
  it('filters non-media URLs before upload',()=>{expect(isMedia('Documentation','https://example.test/docs')).toBe(false);expect(isMedia('Anime episode 12','https://example.test/watch/12')).toBe(true)});
  it('fingerprints canonically and chunks bounded batches',async()=>{expect(await fingerprint({title:' A ',url:'https://EXAMPLE.test/a#tracking'})).toBe(await fingerprint({title:'A',url:'https://example.test/a'}));expect(chunks([1,2,3],2)).toEqual([[1,2],[3]])});
  it('generates eight digit pairing codes',()=>expect(code()).toMatch(/^\d{8}$/));
});
