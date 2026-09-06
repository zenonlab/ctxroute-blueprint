import { describe, expect, it } from 'vitest';
import type { WebExtensionBookmarkNode } from './web-extension-bookmark-adapter';
import { WebExtensionOrganizerAdapter } from './web-extension-organizer-adapter';

function fixture() {
  let sequence = 0;
  const root: WebExtensionBookmarkNode & { parentId?: string } = { children: [], id: 'root', title: '' };
  const toolbar: WebExtensionBookmarkNode & { parentId?: string } = { children: [], id: 'toolbar', index: 0, parentId: 'root', title: 'Toolbar' };
  const source: WebExtensionBookmarkNode & { parentId?: string } = { id: 'bookmark-1', index: 0, parentId: 'toolbar', title: 'Work', url: 'https://reader.example/work' };
  root.children = [toolbar]; toolbar.children = [source];
  const all = () => [root, toolbar, source, ...created];
  const created: Array<WebExtensionBookmarkNode & { parentId?: string }> = [];
  const moves: Array<{ id: string; parentId: string }> = [];
  const api = {
    async create(input: { parentId: string; title: string }) { const node = { children: [], id: `folder-${sequence += 1}`, parentId: input.parentId, title: input.title }; created.push(node); return node; },
    async get(id: string) { return all().filter((node) => node.id === id); },
    async getChildren(id: string) { return all().filter((node) => node.parentId === id); },
    async getTree() { return [root]; },
    async move(id: string, input: { index?: number; parentId: string }) { const node = all().find((item) => item.id === id); if (!node) throw new Error('missing'); node.parentId = input.parentId; if (input.index !== undefined) node.index = input.index; moves.push({ id, parentId: input.parentId }); return node; },
  };
  return { adapter: new WebExtensionOrganizerAdapter(api), moves, source };
}

describe('web extension organizer adapter', () => {
  it('captures first, creates a deterministic destination and restores without deleting', async () => {
    const { adapter, moves, source } = fixture();
    const snapshot = await adapter.captureSnapshot('2026-09-06T10:00:00.000Z');
    await expect(adapter.applyMoves([{ action: 'move', bookmarkId: source.id, destination: ['Tobirink', 'Manga'], ruleId: 'manga', title: source.title }])).resolves.toEqual({ moved: 1, skipped: 0 });
    expect(moves[0]?.parentId).toBe('folder-2');
    await expect(adapter.restoreSnapshot(snapshot)).resolves.toMatchObject({ restored: 1 });
    expect(moves.at(-1)).toEqual({ id: source.id, parentId: 'toolbar' });
  });
});
