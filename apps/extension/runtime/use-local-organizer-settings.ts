import { useCallback, useEffect, useRef, useState } from 'react';
import { parseOrganizerConfiguration } from '@tobirink/application';
import type { OrganizerFolder, OrganizerMove, SettingsProps } from '../entrypoints/options';
import {
  readOrganizerConfigurationMessage,
  readOrganizerPreviewMessage,
  writeOrganizerConfigurationMessage,
} from './messages';
import {
  createEmptyOrganizerRoot,
  moveOrganizerFolder,
  organizerConfigurationToSurface,
  organizerPreviewToSurface,
  organizerSurfaceToConfiguration,
  removeOrganizerFolder,
  reorderOrganizerFolders,
  runtimeOrganizerFilterOptions,
  updateOrganizerFolder,
} from './organizer-settings-model';

interface OrganizerRuntimeState {
  configurationValid: boolean;
  previewFresh: boolean;
  previewItems: readonly OrganizerMove[];
  state: 'error' | 'loading' | 'partial' | 'ready';
  tree: OrganizerFolder;
}

const initialState = (): OrganizerRuntimeState => ({
  configurationValid: true,
  previewFresh: false,
  previewItems: [],
  state: 'loading',
  tree: createEmptyOrganizerRoot(),
});

export function useLocalOrganizerSettings(): SettingsProps {
  const [loadKey, setLoadKey] = useState(0);
  const [model, setModel] = useState<OrganizerRuntimeState>(initialState);
  const treeRef = useRef(model.tree);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const writeRevision = useRef(0);

  useEffect(() => {
    let active = true;
    setModel(initialState());
    void readOrganizerConfigurationMessage().then((wire) => {
      if (!active) return;
      const tree = organizerConfigurationToSurface(wire === undefined ? undefined : parseOrganizerConfiguration(wire));
      treeRef.current = tree;
      setModel({ configurationValid: true, previewFresh: false, previewItems: [], state: 'ready', tree });
    }).catch(() => {
      if (active) setModel((current) => ({ ...current, state: 'error' }));
    });
    return () => { active = false; };
  }, [loadKey]);

  const changeTree = useCallback((update: (tree: OrganizerFolder) => OrganizerFolder) => {
    const tree = update(treeRef.current);
    treeRef.current = tree;
    setModel((current) => ({ ...current, previewFresh: false, state: 'ready', tree }));
    let configuration: ReturnType<typeof organizerSurfaceToConfiguration>;
    try {
      configuration = organizerSurfaceToConfiguration(tree, new Date().toISOString());
    } catch {
      setModel((current) => ({ ...current, configurationValid: false, previewFresh: false }));
      return;
    }
    setModel((current) => ({ ...current, configurationValid: true }));
    const revision = writeRevision.current + 1;
    writeRevision.current = revision;
    const write = writeQueue.current.catch(() => undefined).then(async () => {
      await writeOrganizerConfigurationMessage(configuration);
    });
    writeQueue.current = write;
    void write.then(() => {
      if (writeRevision.current === revision) setModel((current) => ({ ...current, state: 'ready' }));
    }).catch(() => {
      if (writeRevision.current === revision) setModel((current) => ({ ...current, previewFresh: false, state: 'partial' }));
    });
  }, []);

  const requestPreview = useCallback((): boolean => {
    setModel((current) => ({ ...current, previewFresh: false }));
    let configuration: ReturnType<typeof organizerSurfaceToConfiguration>;
    try {
      configuration = organizerSurfaceToConfiguration(treeRef.current, new Date().toISOString());
    } catch {
      setModel((current) => ({ ...current, configurationValid: false, previewFresh: false }));
      return false;
    }
    setModel((current) => ({ ...current, configurationValid: true }));
    void readOrganizerPreviewMessage(configuration).then((snapshot) => {
      setModel((current) => ({
        ...current,
        previewFresh: true,
        previewItems: organizerPreviewToSurface(snapshot),
        state: snapshot.state,
      }));
    }).catch(() => setModel((current) => ({ ...current, previewFresh: false, state: 'partial' })));
    return true;
  }, []);

  const retry = useCallback(() => setLoadKey((key) => key + 1), []);
  if (model.state === 'loading' || model.state === 'error') return { onRetry: retry, state: model.state };

  return {
    configurationValid: model.configurationValid,
    filterOptions: runtimeOrganizerFilterOptions,
    onAddFolder: (parentId) => {
      const id = `folder-${crypto.randomUUID().replaceAll('-', '')}`;
      changeTree((tree) => updateOrganizerFolder(tree, parentId, (parent) => ({
        ...parent,
        children: [...parent.children, { children: [], conditions: { progressStates: [], statuses: [], types: [] }, enabled: true, id, name: 'Nouveau dossier' }],
      })));
      return id;
    },
    onConditionsChange: (id, conditions) => changeTree((tree) => updateOrganizerFolder(tree, id, (folder) => ({ ...folder, conditions }))),
    onFolderNameChange: (id, name) => changeTree((tree) => updateOrganizerFolder(tree, id, (folder) => ({ ...folder, name }))),
    onMoveFolder: (id, direction) => changeTree((tree) => moveOrganizerFolder(tree, id, direction)),
    onRemoveFolder: (id) => changeTree((tree) => removeOrganizerFolder(tree, id)),
    onReorderFolder: (sourceId, targetId) => changeTree((tree) => reorderOrganizerFolders(tree, sourceId, targetId)),
    onRequestPreview: requestPreview,
    previewFresh: model.previewFresh,
    previewItems: model.previewItems,
    state: model.state,
    tree: model.tree,
  };
}
