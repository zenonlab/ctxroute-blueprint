import { createOrganizerConfiguration } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';
import {
  createEmptyOrganizerRoot,
  moveOrganizerFolder,
  organizerConfigurationToSurface,
  organizerPreviewToSurface,
  organizerSurfaceToConfiguration,
  removeOrganizerFolder,
  reorderOrganizerFolders,
  updateOrganizerFolder,
} from './organizer-settings-model';

const root = {
  children: [
    { children: [], conditions: { progressStates: [], statuses: [], types: ['MANGA'] }, id: 'manga', name: 'Manga' },
    { children: [], conditions: { progressStates: [], statuses: [], types: ['ANIME'] }, id: 'anime', name: 'Anime' },
  ],
  conditions: { progressStates: [], statuses: [], types: [] },
  id: 'root',
  name: 'Tobirink',
};

describe('organizer settings model', () => {
  it('maps the durable singleton without inventing conditions', () => {
    const configuration = organizerSurfaceToConfiguration(root, '2026-09-06T00:00:00.000Z');
    expect(configuration.folders[0]?.conditions).toBeUndefined();
    expect(organizerConfigurationToSurface(configuration)).toEqual({ ...root, enabled: true, children: root.children.map((child) => ({ ...child, enabled: true })) });
    expect(organizerConfigurationToSurface(undefined)).toEqual(createEmptyOrganizerRoot());
  });

  it('rejects a durable configuration that cannot fit the single-root surface', () => {
    const configuration = createOrganizerConfiguration({ folders: [], updatedAt: '2026-09-06T00:00:00.000Z' });
    expect(() => organizerConfigurationToSurface(configuration)).toThrowError(/exactly one/);
  });

  it('rejects invalid drafts before they can be persisted or previewed', () => {
    expect(() => organizerSurfaceToConfiguration({ ...root, name: '' }, '2026-09-06T00:00:00.000Z')).toThrow();
    expect(() => organizerSurfaceToConfiguration({
      ...root,
      children: [{ ...root.children[0]!, conditions: { progressStates: [], statuses: [], types: ['VIDEO'] } }],
    }, '2026-09-06T00:00:00.000Z')).toThrowError(/unsupported value/);
  });

  it('updates, removes and reorders folders without mutating the source tree', () => {
    expect(updateOrganizerFolder(root, 'manga', (folder) => ({ ...folder, name: 'Lectures' })).children[0]?.name).toBe('Lectures');
    expect(removeOrganizerFolder(root, 'manga').children.map((folder) => folder.id)).toEqual(['anime']);
    expect(reorderOrganizerFolders(root, 'anime', 'manga').children.map((folder) => folder.id)).toEqual(['anime', 'manga']);
    expect(moveOrganizerFolder(root, 'anime', 'up').children.map((folder) => folder.id)).toEqual(['anime', 'manga']);
    expect(root.children.map((folder) => folder.id)).toEqual(['manga', 'anime']);
  });

  it('maps local preview paths without exposing application details', () => {
    expect(organizerPreviewToSurface({
      inspectedCount: 1,
      items: [{ action: 'move', bookmarkId: 'bookmark-1', destination: ['Tobirink', 'Manga'], ruleId: 'manga', title: 'Frieren' }],
      state: 'ready',
      truncated: false,
    })).toEqual([{ action: 'move', destination: 'Tobirink / Manga', id: 'bookmark-1', title: 'Frieren' }]);
  });
});
