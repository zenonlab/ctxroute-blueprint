import { describe, expect, it, vi } from 'vitest';
import { WebExtensionBookmarkEventAdapter } from './web-extension-bookmark-event-adapter';

function event<TListener extends (...values: never[]) => void>() {
  let listener: TListener | undefined;
  return { addListener: (next: TListener) => { listener = next; }, emit: (...args: Parameters<TListener>) => { listener?.(...args); } };
}

describe('WebExtensionBookmarkEventAdapter', () => {
  it('B-02 maps all four browser mutations to idempotent bounded signals', () => {
    const onCreated = event<(id: string, node: { id: string }) => void>();
    const onChanged = event<(id: string, info: { title?: string; url?: string }) => void>();
    const onMoved = event<(id: string, info: { index: number; parentId: string }) => void>();
    const onRemoved = event<(id: string, info: { index: number; parentId: string }) => void>();
    const listener = vi.fn();
    new WebExtensionBookmarkEventAdapter({ onChanged, onCreated, onMoved, onRemoved }).subscribe(listener);
    onCreated.emit('1', { id: '1' });
    onChanged.emit('2', { title: 'Titre' });
    onMoved.emit('3', { index: 0, parentId: 'root' });
    onRemoved.emit('4', { index: 0, parentId: 'root' });
    expect(listener.mock.calls.map(([value]) => value)).toEqual([
      { bookmarkId: '1', kind: 'created' },
      { bookmarkId: '2', kind: 'changed' },
      { bookmarkId: '3', kind: 'moved' },
      { bookmarkId: '4', kind: 'removed' },
    ]);
  });
});
