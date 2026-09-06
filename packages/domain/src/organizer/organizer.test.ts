import { describe, expect, it } from 'vitest';
import { createOrganizerConfiguration, createOrganizerTree, organizerTreeLimits } from './organizer';

describe('organizer tree invariants', () => {
  it('creates one canonical durable configuration', () => {
    const configuration = createOrganizerConfiguration({
      folders: [{ conditions: { mediaTypes: ['ANIME'] }, id: 'anime', name: 'Anime' }],
      updatedAt: '2026-09-06T00:00:00.000Z',
    });
    expect(configuration.id).toBe('organizer');
    expect(Object.isFrozen(configuration.folders)).toBe(true);
    expect(() => createOrganizerConfiguration({ ...configuration, updatedAt: 'yesterday' })).toThrowError(/canonical/);
  });

  it('normalizes and freezes a bounded local rule tree', () => {
    const tree = createOrganizerTree([{
      children: [{
        conditions: { mediaTypes: ['MANGA'], progressStates: ['active'] },
        id: 'reading-manga',
        name: ' Manga ',
      }],
      id: 'reading',
      name: ' Reading ',
    }]);

    expect(tree[0]?.name).toBe('Reading');
    expect(tree[0]?.children[0]?.name).toBe('Manga');
    expect(Object.isFrozen(tree)).toBe(true);
    expect(Object.isFrozen(tree[0]?.children)).toBe(true);
  });

  it('rejects duplicate ids and unconstrained rules', () => {
    expect(() => createOrganizerTree([
      { id: 'same', name: 'One' },
      { id: 'same', name: 'Two' },
    ])).toThrowError(/unique/);
    expect(() => createOrganizerTree([{
      conditions: {},
      id: 'everything',
      name: 'Everything',
    }])).toThrowError(/constrain/);
    expect(() => createOrganizerTree([{
      conditions: { minimumStoppedProgress: 5, progressStates: ['active'] },
      id: 'impossible',
      name: 'Impossible',
    }])).toThrowError(/stopped progress state/);
  });

  it('bounds depth and node count', () => {
    let nested = { id: 'level-9', name: 'Level 9' };
    for (let depth = 8; depth >= 1; depth -= 1) nested = { children: [nested], id: `level-${depth}`, name: `Level ${depth}` };
    expect(() => createOrganizerTree([nested])).toThrowError(/levels/);

    const tooMany = Array.from({ length: organizerTreeLimits.maxNodes + 1 }, (_, index) => ({ id: `folder-${index}`, name: `Folder ${index}` }));
    expect(() => createOrganizerTree(tooMany)).toThrowError(/at most/);
  });
});
