import type { Task } from 'graphile-worker';

export function inferFavoriteMediaType(sourceType: string, _bookmarkTitle: string) {
  // The URL parser is the identity authority. A release marker in a Chrome
  // label must never override an explicit /manga, /manhwa or /manhua path.
  return sourceType;
}
const task:Task=async(raw,helpers)=>{
  // Compatibility tombstone: old Graphile jobs may have any historical
  // payload/provenance. Identity now starts in the shared parser/provider
  // pipelines and a source-resolve job is always observationally a no-op.
  void raw;
  helpers.logger?.info?.('[resolve-favorite] ignored legacy source-resolution job');
};
export default task;
