// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FacetSelect } from '@tobirink/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryFiltersValue } from '@tobirink/ui';
import type { ComponentProps } from 'react';
import { Library } from '../entrypoints/library';
import { LibrarySurfaceContent } from './ExtensionSurface';

const readLibraryCatalogueMessage = vi.fn();

function renderLibrary({ filters, items, onChangeFilters, onLoadMore }: {
    filters: LibraryFiltersValue;
    items: readonly { id: string; title: string }[];
    onChangeFilters: (value: LibraryFiltersValue) => void;
    onLoadMore: () => void;
  }) {
  return (
    <main>
      <button onClick={onLoadMore} type="button">load more</button>
      <button onClick={() => onChangeFilters({ ...filters, query: 'new' })} type="button">change query</button>
      {items.map((item) => <p key={item.id}>{item.title}</p>)}
    </main>
  );
}

afterEach(() => {
  cleanup();
  readLibraryCatalogueMessage.mockReset();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function snapshot(title: string, nextOffset?: number) {
  const result = {
    facets: { format: [], genre: [], progress: [], source: [], status: [], type: [], year: [] },
    items: [{ id: `work_${title.toLocaleLowerCase()}-item`, mediaType: 'anime', source: 'anilist', title }],
    statistics: { completed: 0, inProgress: 0, knownMetadata: 1, notStarted: 1, total: 1 },
    total: 1,
    truncated: nextOffset !== undefined,
  };
  if (nextOffset !== undefined) return { ...result, nextOffset };
  return result;
}

describe('LibrarySurface', () => {
  it('ignores a stale next page after the catalogue input changes', async () => {
    const stalePage = deferred<ReturnType<typeof snapshot>>();
    readLibraryCatalogueMessage.mockImplementation((input: { offset?: number; query?: string }) => {
      if (input.offset === 24) return stalePage.promise;
      return Promise.resolve(input.query === 'new' ? snapshot('New') : snapshot('Old', 24));
    });

    // SAFETY: the injected renderer never reads navigation; the test exercises only catalogue request coordination.
    const navigation = {} as ComponentProps<typeof Library>['navigation'];
    render(<LibrarySurfaceContent navigation={navigation} readCatalogue={readLibraryCatalogueMessage} renderLibrary={renderLibrary} />);
    expect(await screen.findByText('Old')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'load more' }));
    fireEvent.click(screen.getByRole('button', { name: 'change query' }));
    expect(await screen.findByText('New')).toBeTruthy();

    await act(async () => { stalePage.resolve(snapshot('Stale')); });
    await waitFor(() => expect(screen.queryByText('Stale')).toBeNull());
    expect(screen.getByText('New')).toBeTruthy();
  });
});

describe('FacetSelect interactions', () => {
  function ControlledFacet() {
    const [value, setValue] = useState({});
    return <FacetSelect label="Genre" onChange={setValue} options={[{ count: 2, label: 'Fantasy', value: 'fantasy' }]} value={value} />;
  }

  it('keeps the disclosure open while cycling multiple selection states', () => {
    render(<ControlledFacet />);
    const trigger = screen.getByRole('button', { name: 'Genre' });
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole('button', { name: 'Fantasy : neutre' }));
    expect(screen.getByRole('group', { name: 'Genre — filtres' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fantasy : inclus' }));
    expect(screen.getByRole('button', { name: 'Fantasy : exclu' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fantasy : exclu' }));
    expect(screen.getByRole('button', { name: 'Fantasy : neutre' })).toBeTruthy();
  });

  it('closes with Escape and restores focus to the disclosure button', () => {
    render(<ControlledFacet />);
    const trigger = screen.getByRole('button', { name: 'Genre' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('group', { name: 'Genre — filtres' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Genre — filtres' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
