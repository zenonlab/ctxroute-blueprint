import {
  createOrganizerConfiguration,
  organizerEditorialStatuses,
  organizerMediaTypes,
  organizerProgressStates,
} from '@tobirink/domain';
import type {
  OrganizerConditionsInput,
  OrganizerConfiguration,
  OrganizerFolder as DomainOrganizerFolder,
  OrganizerFolderInput,
} from '@tobirink/domain';
import type {
  OrganizerConditions,
  OrganizerFilterOptions,
  OrganizerFolder,
  OrganizerMove,
} from '../entrypoints/options';
import type { OrganizerPreviewResponse } from './messages';

export const runtimeOrganizerFilterOptions: OrganizerFilterOptions = Object.freeze({
  progressStates: [],
  statuses: [],
  stoppedStateId: 'stopped',
  types: [
    { id: 'MANGA', label: 'Manga' },
    { id: 'ANIME', label: 'Anime' },
  ],
});

const emptyConditions = (): OrganizerConditions => ({ progressStates: [], statuses: [], types: [] });

export function createEmptyOrganizerRoot(): OrganizerFolder {
  return { children: [], conditions: emptyConditions(), enabled: true, id: 'root', name: 'Tobirink' };
}

function toSurfaceFolder(folder: DomainOrganizerFolder): OrganizerFolder {
  const conditions: OrganizerConditions = {
    progressStates: folder.conditions?.progressStates ?? [],
    statuses: folder.conditions?.editorialStatuses ?? [],
    types: folder.conditions?.mediaTypes ?? [],
  };
  if (folder.conditions?.minimumStoppedProgress !== undefined) {
    conditions.stoppedAfter = folder.conditions.minimumStoppedProgress;
  }
  return {
    children: folder.children.map(toSurfaceFolder),
    conditions,
    enabled: folder.enabled,
    id: folder.id,
    name: folder.name,
  };
}

export function organizerConfigurationToSurface(configuration: OrganizerConfiguration | undefined): OrganizerFolder {
  if (configuration === undefined) return createEmptyOrganizerRoot();
  if (configuration.folders.length !== 1 || configuration.folders[0] === undefined) {
    throw new Error('Settings requires exactly one organizer root.');
  }
  return toSurfaceFolder(configuration.folders[0]);
}

function knownValues<T extends string>(values: readonly string[], allowed: readonly T[], label: string): readonly T[] {
  const result: T[] = [];
  for (const value of values) {
    const known = allowed.find((candidate) => candidate === value);
    if (known === undefined) throw new Error(`${label} contains an unsupported value.`);
    result.push(known);
  }
  return result;
}

function toConditions(input: OrganizerConditions): OrganizerConditionsInput | undefined {
  const mediaTypes = knownValues(input.types, organizerMediaTypes, 'Types');
  const editorialStatuses = knownValues(input.statuses, organizerEditorialStatuses, 'Statuses');
  const progressStates = knownValues(input.progressStates, organizerProgressStates, 'Progress states');
  if (mediaTypes.length === 0 && editorialStatuses.length === 0 && progressStates.length === 0 && input.stoppedAfter === undefined) return undefined;
  const base: OrganizerConditionsInput = { editorialStatuses, mediaTypes, progressStates };
  return input.stoppedAfter === undefined ? base : { ...base, minimumStoppedProgress: input.stoppedAfter };
}

function toDomainFolder(folder: OrganizerFolder): OrganizerFolderInput {
  const base: OrganizerFolderInput = {
    children: folder.children.map(toDomainFolder),
    enabled: folder.enabled ?? true,
    id: folder.id,
    name: folder.name,
  };
  const conditions = toConditions(folder.conditions);
  return conditions === undefined ? base : { ...base, conditions };
}

export function organizerSurfaceToConfiguration(tree: OrganizerFolder, updatedAt: string): OrganizerConfiguration {
  return createOrganizerConfiguration({ folders: [toDomainFolder(tree)], updatedAt });
}

export function updateOrganizerFolder(tree: OrganizerFolder, id: string, update: (folder: OrganizerFolder) => OrganizerFolder): OrganizerFolder {
  if (tree.id === id) return update(tree);
  return { ...tree, children: tree.children.map((child) => updateOrganizerFolder(child, id, update)) };
}

export function removeOrganizerFolder(tree: OrganizerFolder, id: string): OrganizerFolder {
  return {
    ...tree,
    children: tree.children.filter((child) => child.id !== id).map((child) => removeOrganizerFolder(child, id)),
  };
}

export function reorderOrganizerFolders(tree: OrganizerFolder, sourceId: string, targetId: string): OrganizerFolder {
  const sourceIndex = tree.children.findIndex((child) => child.id === sourceId);
  const targetIndex = tree.children.findIndex((child) => child.id === targetId);
  if (sourceIndex !== -1 && targetIndex !== -1) {
    const children = [...tree.children];
    const [source] = children.splice(sourceIndex, 1);
    if (source === undefined) return tree;
    children.splice(targetIndex, 0, source);
    return { ...tree, children };
  }
  return { ...tree, children: tree.children.map((child) => reorderOrganizerFolders(child, sourceId, targetId)) };
}

export function moveOrganizerFolder(tree: OrganizerFolder, id: string, direction: 'down' | 'up'): OrganizerFolder {
  const index = tree.children.findIndex((child) => child.id === id);
  if (index !== -1) {
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= tree.children.length) return tree;
    const children = [...tree.children];
    const current = children[index];
    const next = children[nextIndex];
    if (current === undefined || next === undefined) return tree;
    children[index] = next;
    children[nextIndex] = current;
    return { ...tree, children };
  }
  return { ...tree, children: tree.children.map((child) => moveOrganizerFolder(child, id, direction)) };
}

export function organizerPreviewToSurface(snapshot: Extract<OrganizerPreviewResponse, { ok: true }>['snapshot']): readonly OrganizerMove[] {
  return snapshot.items.map((item) => ({
    action: item.action,
    destination: item.destination?.join(' / ') ?? 'Dossier actuel',
    id: item.bookmarkId,
    title: item.title,
  }));
}
