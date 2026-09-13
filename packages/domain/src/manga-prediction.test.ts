import { describe, expect, it } from 'vitest';
import { predictNextMangaRelease } from './manga-prediction';
describe('manga prediction', () => {
  it('requires three bounded intervals and emits one estimate', () => {
    const observations = [1, 2, 3, 4].map((day, index) => ({ chapter: index + 1, releasedOn: `2026-09-${String(day).padStart(2, '0')}` }));
    expect(predictNextMangaRelease(observations)).toMatchObject({ releasedOn: '2026-09-05', confidence: 'estimated', basedOn: 3 });
  });
  it('rejects insufficient history', () => { expect(predictNextMangaRelease([{ chapter: 1, releasedOn: '2026-09-01' }])).toBeUndefined(); });
});
