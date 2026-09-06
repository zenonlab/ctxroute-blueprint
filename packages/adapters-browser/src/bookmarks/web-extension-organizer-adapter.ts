import { organizerBookmarkSnapshotSchema } from '@tobirink/application';
import type { OrganizerBookmarkSnapshot, OrganizerPreviewItem, OrganizerProjectionPort } from '@tobirink/application';
import type { WebExtensionBookmarkNode } from './web-extension-bookmark-adapter';

interface MutableBookmarkNode extends WebExtensionBookmarkNode { parentId?: string }
interface OrganizerSnapshotNodeDraft { id: string; index?: number; parentId?: string; title: string; url?: string }
interface OrganizerMoveDestination { index?: number; parentId: string }

export interface WebExtensionOrganizerBookmarksApi {
  create(input: { parentId: string; title: string }): Promise<MutableBookmarkNode>;
  get(id: string): Promise<readonly MutableBookmarkNode[]>;
  getChildren(id: string): Promise<readonly MutableBookmarkNode[]>;
  getTree(): Promise<readonly MutableBookmarkNode[]>;
  move(id: string, destination: { index?: number; parentId: string }): Promise<MutableBookmarkNode>;
}

function flatten(nodes: readonly MutableBookmarkNode[], output: MutableBookmarkNode[] = []): MutableBookmarkNode[] {
  for (const node of nodes) { output.push(node); if (node.children) flatten(node.children, output); }
  return output;
}

async function existingNode(api: WebExtensionOrganizerBookmarksApi, id: string): Promise<MutableBookmarkNode | undefined> {
  try { return (await api.get(id))[0]; } catch { return undefined; }
}

export class WebExtensionOrganizerAdapter implements OrganizerProjectionPort {
  constructor(private readonly bookmarks: WebExtensionOrganizerBookmarksApi) {}

  async captureSnapshot(capturedAt: string): Promise<OrganizerBookmarkSnapshot> {
    const nodes = flatten(await this.bookmarks.getTree()).map((node) => {
      const snapshotNode: OrganizerSnapshotNodeDraft = { id: node.id, title: node.title };
      if (node.index !== undefined) snapshotNode.index = node.index;
      if (node.parentId !== undefined) snapshotNode.parentId = node.parentId;
      if (node.url !== undefined) snapshotNode.url = node.url;
      return snapshotNode;
    });
    return organizerBookmarkSnapshotSchema.parse({ capturedAt, format: 'tobirink-organizer-bookmarks', nodes, version: 1 });
  }

  private async projectionRoot(bookmarkId: string): Promise<string> {
    const tree = await this.bookmarks.getTree();
    const root = tree[0];
    const byId = new Map(flatten(tree).map((node) => [node.id, node]));
    let current = byId.get(bookmarkId);
    if (!root || !current) throw new Error('Organizer bookmark is no longer available.');
    while (current.parentId && current.parentId !== root.id) {
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    if (current.id === bookmarkId && current.parentId === root.id) throw new Error('Organizer destination root is unavailable.');
    return current.id;
  }

  private async ensurePath(rootId: string, path: readonly string[]): Promise<string> {
    let parentId = rootId;
    for (const title of path) {
      const children = await this.bookmarks.getChildren(parentId);
      const existing = children.find((node) => node.url === undefined && node.title === title);
      parentId = existing?.id ?? (await this.bookmarks.create({ parentId, title })).id;
    }
    return parentId;
  }

  async applyMoves(moves: readonly OrganizerPreviewItem[]): Promise<{ moved: number; skipped: number }> {
    if (moves.length === 0) return { moved: 0, skipped: 0 };
    const ordered = [...moves].sort((left, right) => left.bookmarkId.localeCompare(right.bookmarkId));
    const rootId = await this.projectionRoot(ordered[0]?.bookmarkId ?? '');
    let moved = 0;
    let skipped = 0;
    for (const move of ordered) {
      const current = await existingNode(this.bookmarks, move.bookmarkId);
      if (!current?.url || !move.destination) { skipped += 1; continue; }
      const parentId = await this.ensurePath(rootId, move.destination);
      if (current.parentId === parentId) { skipped += 1; continue; }
      await this.bookmarks.move(move.bookmarkId, { parentId });
      moved += 1;
    }
    return { moved, skipped };
  }

  async restoreSnapshot(snapshot: OrganizerBookmarkSnapshot): Promise<{ restored: number; skipped: number }> {
    const validated = organizerBookmarkSnapshotSchema.parse(snapshot);
    const available = new Set(flatten(await this.bookmarks.getTree()).map((node) => node.id));
    let restored = 0;
    let skipped = 0;
    const bookmarks = validated.nodes.filter((item) => item.url !== undefined).sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
    for (const node of bookmarks) {
      if (!node.parentId || !available.has(node.parentId)) { skipped += 1; continue; }
      const current = await existingNode(this.bookmarks, node.id);
      if (!current?.url) { skipped += 1; continue; }
      if (current.parentId === node.parentId && current.index === node.index) { skipped += 1; continue; }
      const destination: OrganizerMoveDestination = { parentId: node.parentId };
      if (node.index !== undefined) destination.index = node.index;
      await this.bookmarks.move(node.id, destination);
      restored += 1;
    }
    return { restored, skipped };
  }
}
