export interface MangaReleaseObservation { readonly releasedOn: string; readonly chapter: number; }
export interface MangaReleasePrediction { readonly releasedOn: string; readonly confidence: 'estimated'; readonly basedOn: number; }
export type ReleaseLifecycleStatus = 'FINISHED' | 'COMPLETED' | 'CANCELLED' | 'ONGOING' | 'RELEASING' | 'HIATUS' | 'UNKNOWN';
export function predictNextMangaRelease(observations: readonly MangaReleaseObservation[], lifecycle: ReleaseLifecycleStatus = 'UNKNOWN'): MangaReleasePrediction | undefined {
  if (lifecycle === 'FINISHED' || lifecycle === 'COMPLETED' || lifecycle === 'CANCELLED') return undefined;
  const validObservations = observations.filter(({ chapter, releasedOn }) => Number.isFinite(chapter) && chapter >= 0 && /^\d{4}-\d{2}-\d{2}$/u.test(releasedOn) && new Date(`${releasedOn}T00:00:00.000Z`).toISOString().slice(0, 10) === releasedOn);
  const byChapter = new Map<number, MangaReleaseObservation>();
  for (const observation of validObservations) {
    const previous = byChapter.get(observation.chapter);
    if (!previous || observation.releasedOn < previous.releasedOn) byChapter.set(observation.chapter, observation);
  }
  const ordered = [...byChapter.values()].sort((a, b) => a.releasedOn.localeCompare(b.releasedOn) || a.chapter - b.chapter).slice(-12);
  const intervals = ordered.slice(1).flatMap((item, i) => {
    const previous = ordered[i]!;
    const chapterDelta = item.chapter - previous.chapter;
    const elapsed = Date.parse(item.releasedOn) - Date.parse(previous.releasedOn);
    return chapterDelta > 0 && elapsed > 0 ? [elapsed / chapterDelta] : [];
  }).slice(-8);
  if (intervals.length < 3) return undefined;
  const sorted = [...intervals].sort((a, b) => a - b); const median = sorted[Math.floor(sorted.length / 2)]!;
  const valid = intervals.filter((value) => value >= median * 0.5 && value <= median * 2);
  if (valid.length < 3) return undefined;
  const next = Date.parse(ordered.at(-1)!.releasedOn) + Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
  return { releasedOn: new Date(next).toISOString().slice(0, 10), confidence: 'estimated', basedOn: valid.length };
}
