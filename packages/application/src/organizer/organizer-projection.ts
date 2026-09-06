import { z } from 'zod';
import type { OrganizerConfiguration } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';
import { readOrganizerPreview } from './organizer-workspace';
import type { OrganizerPreviewItem } from './build-organizer-preview';
import type { OrganizerPreviewSnapshot } from './organizer-workspace';

const organizerSnapshotNodeSchema = z.strictObject({
  id: z.string().min(1).max(256),
  index: z.number().int().nonnegative().optional(),
  parentId: z.string().min(1).max(256).optional(),
  title: z.string().max(1024),
  url: z.string().max(8192).optional(),
});

export const organizerBookmarkSnapshotSchema = z.strictObject({
  capturedAt: z.iso.datetime(),
  format: z.literal('tobirink-organizer-bookmarks'),
  nodes: z.array(organizerSnapshotNodeSchema).max(20_000),
  version: z.literal(1),
});

export type OrganizerBookmarkSnapshot = z.infer<typeof organizerBookmarkSnapshotSchema>;

export interface OrganizerProjectionPort {
  applyMoves(moves: readonly OrganizerPreviewItem[]): Promise<{ moved: number; skipped: number }>;
  captureSnapshot(capturedAt: string): Promise<OrganizerBookmarkSnapshot>;
  restoreSnapshot(snapshot: OrganizerBookmarkSnapshot): Promise<{ restored: number; skipped: number }>;
}

export interface OrganizerSnapshotStorePort {
  load(): Promise<OrganizerBookmarkSnapshot | undefined>;
  save(snapshot: OrganizerBookmarkSnapshot): Promise<void>;
}

function samePreview(left: OrganizerPreviewSnapshot, right: OrganizerPreviewSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function applyConfirmedOrganizerPreview(
  dependencies: { bookmarks: OrganizerProjectionPort; snapshots: OrganizerSnapshotStorePort; storage: StoragePort },
  input: { configuration: OrganizerConfiguration; confirmation: string; expected: OrganizerPreviewSnapshot; now: string },
): Promise<{ moved: number; skipped: number }> {
  if (input.confirmation !== 'apply-organizer-preview') throw new Error('Applying an organizer preview requires explicit confirmation.');
  const current = await readOrganizerPreview(dependencies.storage, input.configuration);
  if (current.state !== 'ready' || current.truncated || !samePreview(current, input.expected)) throw new Error('Organizer preview is stale or incomplete.');
  const snapshot = organizerBookmarkSnapshotSchema.parse(await dependencies.bookmarks.captureSnapshot(input.now));
  await dependencies.snapshots.save(snapshot);
  const persisted = await dependencies.snapshots.load();
  if (persisted === undefined || JSON.stringify(persisted) !== JSON.stringify(snapshot)) throw new Error('Organizer snapshot verification failed.');
  return dependencies.bookmarks.applyMoves(current.items.filter((item) => item.action === 'move'));
}

export async function restoreConfirmedOrganizerSnapshot(
  dependencies: { bookmarks: OrganizerProjectionPort; snapshots: OrganizerSnapshotStorePort },
  confirmation: string,
): Promise<{ restored: number; skipped: number }> {
  if (confirmation !== 'restore-organizer-snapshot') throw new Error('Restoring organizer bookmarks requires explicit confirmation.');
  const snapshot = await dependencies.snapshots.load();
  if (snapshot === undefined) throw new Error('No organizer snapshot is available.');
  return dependencies.bookmarks.restoreSnapshot(organizerBookmarkSnapshotSchema.parse(snapshot));
}
