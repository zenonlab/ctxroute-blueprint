import { describe, expect, it } from 'vitest';
import { predictNextMangaRelease } from './manga-prediction';
describe('manga prediction', () => {
  it('requires three bounded intervals and emits one estimate', () => {
    const observations = [1, 2, 3, 4].map((day, index) => ({ chapter: index + 1, releasedOn: `2026-09-${String(day).padStart(2, '0')}` }));
    expect(predictNextMangaRelease(observations)).toMatchObject({ releasedOn: '2026-09-05', confidence: 'estimated', basedOn: 3 });
  });
  it('rejects insufficient history', () => { expect(predictNextMangaRelease([{ chapter: 1, releasedOn: '2026-09-01' }])).toBeUndefined(); });
  it('normalizes skipped chapters and rejects calendar-invalid observations', () => {
    expect(predictNextMangaRelease([
      { chapter: 1, releasedOn: '2026-09-01' },
      { chapter: 3, releasedOn: '2026-09-03' },
      { chapter: 5, releasedOn: '2026-09-05' },
      { chapter: 7, releasedOn: '2026-09-07' },
      { chapter: 8, releasedOn: '2026-02-30' },
    ])).toMatchObject({ basedOn: 3, releasedOn: '2026-09-08' });
  });
  it('uses at most the last eight intervals and filters a cadence outlier', () => {
    const observations = Array.from({ length: 13 }, (_, index) => ({ chapter: index + 1, releasedOn: `2026-09-${String(index + 1).padStart(2, '0')}` }));
    observations[11] = { chapter: 12, releasedOn: '2026-10-12' };
    observations[12] = { chapter: 13, releasedOn: '2026-10-13' };
    expect(predictNextMangaRelease(observations)).toMatchObject({ releasedOn: '2026-10-14' });
  });
});
