import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('MangaDex fallback resolution boundary', () => {
  const source = readFileSync(new URL('./mangaupdates-enrichment.ts', import.meta.url), 'utf8');

  it('runs only after MangaUpdates NO_MATCH and accepts a unique MangaDex identity', () => {
    expect(source).toMatch(/matchDecision\.status === 'NO_MATCH'[\s\S]+searchMangaDexManga\(query/u);
    expect(source).toContain('fetchMangaDexManga(mangaDexCandidate.id');
    expect(source).toContain("provider='mangadex'");
    expect(source).toMatch(/saveCover\([^\n]+mangadex/u);
    expect(source).toContain('mangadex-valid-resolution');
  });

  it('uses a dedicated decision and records bounded bridge provenance', () => {
    expect(source).toContain("'mangadex-mangaupdates-bridge'");
    expect(source).toContain('mangaDexBridgeVersion: CONNECTOR_VERSIONS.mangaDexBridge');
    expect(source).toContain('examinedTitles:');
    expect(source).toContain("spacingMs: 1000");
    expect(source).toContain('mangadex_promotion_state');
  });

  it('keeps a unique MangaDex resolution when links.mu cannot be verified',()=>{
    expect(source).toContain('bridge_link_unavailable');
    expect(source).toMatch(/if \(linked\)[\s\S]+else \{[\s\S]+MANGADEX_VALID_RESOLUTION/u);
    expect(source).toContain('Weekly promotion');
  });

  it('resolves links.mu through the shared public-slug connector',()=>{
    expect(source).toContain('resolveMangaUpdatesLinkedSeries');
    expect(source).toContain("operation: 'resolve-bridged-link'");
    expect(source).toContain('linkedValueKind: resolution.method');
  });

  it('reuses the durable MangaDex payload during an explicit promotion replay',()=>{
    expect(source).toContain('parseMangaDexManga(c.mangadex_payload)');
    expect(source).toContain("operation: 'resolve-stored-mangadex-link'");
    expect(source).toMatch(/if \(!fastPath && forceRefresh && c\.mangadex_id/u);
    expect(source).toContain("SET status='PROMOTED',mangaupdates_id=$2");
  });

  it('never persists MangaDex chapter or volume availability',()=>{
    expect(source).not.toContain("['latestChapter',mangaDex.latestChapter]");
    expect(source).not.toContain("['latestVolume',mangaDex.latestVolume]");
    expect(source).not.toContain('mangaDex.latestChapter??null');
    expect(source).not.toMatch(/provider_progress[^;]+provider='mangadex'/u);
  });
});
