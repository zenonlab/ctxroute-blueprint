export interface MangaReleaseObservation { readonly releasedOn: string; readonly chapter: number; }
export interface MangaReleasePrediction { readonly releasedOn: string; readonly confidence: 'estimated'; readonly basedOn: number; }
export function predictNextMangaRelease(observations: readonly MangaReleaseObservation[]): MangaReleasePrediction | undefined {
  const ordered = [...observations].sort((a, b) => a.releasedOn.localeCompare(b.releasedOn)).slice(-12);
  const intervals = ordered.slice(1).map((item, i) => Date.parse(item.releasedOn) - Date.parse(ordered[i]!.releasedOn)).filter((value) => value > 0).slice(-8);
  if (intervals.length < 3) return undefined;
  const sorted = [...intervals].sort((a, b) => a - b); const median = sorted[Math.floor(sorted.length / 2)]!;
  const valid = intervals.filter((value) => value >= median * 0.5 && value <= median * 2);
  if (valid.length < 3) return undefined;
  const next = Date.parse(ordered.at(-1)!.releasedOn) + Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
  return { releasedOn: new Date(next).toISOString().slice(0, 10), confidence: 'estimated', basedOn: valid.length };
}
