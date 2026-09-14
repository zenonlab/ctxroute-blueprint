export const favlibAgendaVolume = Object.freeze({
  aniListPageSize: 50,
  aniListReleases: 1_501,
  mangaUpdatesPageSize: 40,
  mangaUpdatesReleases: 466,
});

export function pageLength(total: number, pageSize: number, page: number): number {
  return Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize));
}
