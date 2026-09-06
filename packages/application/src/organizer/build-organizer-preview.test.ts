import { createOrganizerTree } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';
import { buildOrganizerPreview } from './build-organizer-preview';

const tree = createOrganizerTree([{
  children: [
    { conditions: { editorialStatuses: ['Ongoing'], mediaTypes: ['MANGA'] }, id: 'manga-ongoing', name: 'En cours' },
    { conditions: { mediaTypes: ['MANGA'] }, id: 'manga-any', name: 'Tous' },
    { conditions: { minimumStoppedProgress: 10, progressStates: ['stopped'] }, id: 'stopped-late', name: 'À reprendre' },
  ],
  id: 'reading',
  name: 'Lecture',
}]);

describe('buildOrganizerPreview', () => {
  it('uses deterministic pre-order priority and AND conditions', () => {
    const preview = buildOrganizerPreview(tree, [
      { bookmarkId: 'b-1', currentFolderPath: ['Imports'], title: 'Frieren' },
    ], [
      { bookmarkId: 'b-1', editorialStatus: 'Ongoing', mediaType: 'MANGA', progressState: 'active', recognized: true },
    ]);

    expect(preview).toEqual([{
      action: 'move',
      bookmarkId: 'b-1',
      destination: ['Lecture', 'En cours'],
      ruleId: 'manga-ongoing',
      title: 'Frieren',
    }]);
  });

  it('does not bypass a higher-priority rule when its required data is missing', () => {
    const preview = buildOrganizerPreview(tree, [
      { bookmarkId: 'b-2', currentFolderPath: ['Imports'], title: 'Unknown status' },
    ], [
      { bookmarkId: 'b-2', mediaType: 'MANGA', recognized: true },
    ]);

    expect(preview[0]).toMatchObject({ action: 'keep', reason: 'insufficient-context' });
  });

  it('fails closed when context is absent or duplicated', () => {
    const preview = buildOrganizerPreview(tree, [
      { bookmarkId: 'missing', currentFolderPath: [], title: 'Missing' },
      { bookmarkId: 'duplicate', currentFolderPath: [], title: 'Duplicate' },
    ], [
      { bookmarkId: 'duplicate', editorialStatus: 'Ongoing', mediaType: 'MANGA', recognized: true },
      { bookmarkId: 'duplicate', editorialStatus: 'Completed', mediaType: 'MANGA', recognized: true },
    ]);

    expect(preview.map((item) => item.reason)).toEqual(['insufficient-context', 'insufficient-context']);
  });

  it('never moves unrecognized bookmarks and enforces stopped progress thresholds', () => {
    const preview = buildOrganizerPreview(tree, [
      { bookmarkId: 'b-3', currentFolderPath: [], title: 'Unknown' },
      { bookmarkId: 'b-4', currentFolderPath: [], title: 'Paused early' },
      { bookmarkId: 'b-5', currentFolderPath: [], title: 'Paused late' },
    ], [
      { bookmarkId: 'b-3', recognized: false },
      { bookmarkId: 'b-4', mediaType: 'ANIME', progressNumber: 4, progressState: 'stopped', recognized: true },
      { bookmarkId: 'b-5', mediaType: 'ANIME', progressNumber: 12, progressState: 'stopped', recognized: true },
    ]);

    expect(preview.map(({ action, reason, ruleId }) => ({ action, reason, ruleId }))).toEqual([
      { action: 'keep', reason: 'unrecognized', ruleId: undefined },
      { action: 'keep', reason: 'no-match', ruleId: undefined },
      { action: 'move', reason: undefined, ruleId: 'stopped-late' },
    ]);
  });

  it('keeps a bookmark already at the winning destination', () => {
    const preview = buildOrganizerPreview(tree, [
      { bookmarkId: 'b-6', currentFolderPath: ['Lecture', 'Tous'], title: 'Complete' },
    ], [
      { bookmarkId: 'b-6', editorialStatus: 'Completed', mediaType: 'MANGA', recognized: true },
    ]);

    expect(preview[0]).toMatchObject({ action: 'keep', reason: 'already-in-destination', ruleId: 'manga-any' });
  });
});
