import { describe, expect, it } from 'vitest';
import { popupContinuationLimit, readPopupContext } from './popup-context';
import type { PopupContinuationRecord } from './popup-context';

function record(id: string, visitedAt: string, overrides: Partial<PopupContinuationRecord> = {}): PopupContinuationRecord {
  return {
    id,
    mediaType: 'Manga',
    source: 'example.test',
    title: id,
    url: `https://example.test/${id}`,
    visitedAt,
    ...overrides,
  };
}

describe('readPopupContext', () => {
  it('extracts the work and preserves its latest useful page', async () => {
    const writes: PopupContinuationRecord[][] = [];
    const cache = {
      read: async () => [record('frieren', '2026-09-03T10:00:00.000Z', { url: 'https://other.test/frieren-1' })],
      write: async (items: readonly PopupContinuationRecord[]) => { writes.push([...items]); },
    };
    const result = await readPopupContext({
      cache,
      now: () => '2026-09-04T10:00:00.000Z',
      pageContext: { readActivePage: async () => ({ title: 'Frieren — Chapitre 141 — Example', url: 'https://example.test/frieren/141' }) },
    });

    expect(result.active).toMatchObject({ id: 'frieren', source: 'example.test', title: 'Frieren', url: 'https://example.test/frieren/141' });
    expect(result.continuations).toEqual([]);
    expect(writes.at(-1)?.[0]?.url).toBe('https://example.test/frieren/141');
  });

  it('expires old and completed entries and keeps the cache bounded', async () => {
    let written: readonly PopupContinuationRecord[] = [];
    const recent = Array.from({ length: 7 }, (_, index) => record(`work-${index}`, `2026-09-0${index + 1}T10:00:00.000Z`));
    const result = await readPopupContext({
      cache: {
        read: async () => [
          ...recent,
          record('finished', '2026-09-04T10:00:00.000Z', { completed: true }),
          record('expired', '2026-07-01T10:00:00.000Z'),
        ],
        write: async (items) => { written = items; },
      },
      now: () => '2026-09-08T10:00:00.000Z',
      pageContext: { readActivePage: async () => undefined },
    });

    expect(result.continuations).toHaveLength(popupContinuationLimit);
    expect(result.continuations.map(({ id }) => id)).not.toContain('finished');
    expect(result.continuations.map(({ id }) => id)).not.toContain('expired');
    expect(written).toHaveLength(popupContinuationLimit);
  });

  it('ignores browser-internal pages while preserving cached continuations', async () => {
    const cached = [record('dandadan', '2026-09-04T09:00:00.000Z')];
    const result = await readPopupContext({
      cache: { read: async () => cached, write: async () => undefined },
      now: () => '2026-09-04T10:00:00.000Z',
      pageContext: { readActivePage: async () => ({ title: 'Extensions', url: 'chrome://extensions' }) },
    });
    expect(result).toEqual({ continuations: cached });
  });
});
