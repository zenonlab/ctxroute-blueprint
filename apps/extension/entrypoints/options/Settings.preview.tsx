import { useRef, useState } from 'react';
import { definePreview } from '@tobirink/ui/preview-contract';
import '../../../../packages/ui/src/tokens/color.css';
import '../../../../packages/ui/src/tokens/layout.css';
import '../../../../packages/ui/src/tokens/effects.css';
import { Settings, settingsStates, settingsVariants } from './index';
import type {
  OrganizerConditions,
  OrganizerFilterOptions,
  OrganizerFolder,
  OrganizerMove,
  SettingsState,
} from './index';
import styles from './Settings.module.css';

const emptyConditions: OrganizerConditions = {
  progressStates: [],
  statuses: [],
  types: [],
};

const initialTree: OrganizerFolder = {
  children: [
    {
      children: [
        {
          children: [],
          conditions: { ...emptyConditions, progressStates: ['active'], types: ['MANGA', 'MANHWA'] },
          id: 'reading',
          name: 'À lire',
        },
        {
          children: [],
          conditions: { ...emptyConditions, progressStates: ['finished'] },
          id: 'finished-manga',
          name: 'Terminés',
        },
      ],
      conditions: { ...emptyConditions },
      id: 'manga',
      name: 'Manga',
    },
    {
      children: [
        {
          children: [],
          conditions: { ...emptyConditions, progressStates: ['active'], types: ['ANIME'] },
          id: 'watching',
          name: 'À regarder',
        },
      ],
      conditions: { ...emptyConditions },
      id: 'anime',
      name: 'Anime',
    },
  ],
  conditions: { ...emptyConditions },
  id: 'root',
  name: 'Tobirink',
};

const filterOptions: OrganizerFilterOptions = {
  progressStates: [
    { id: 'active', label: 'En cours' },
    { id: 'finished', label: 'Terminé' },
    { id: 'stopped', label: 'Arrêté' },
  ],
  statuses: [
    { id: 'Ongoing', label: 'En publication' },
    { id: 'Completed', label: 'Terminé' },
    { id: 'Hiatus', label: 'En pause' },
    { id: 'Cancelled', label: 'Annulé' },
  ],
  stoppedStateId: 'stopped',
  types: [
    { id: 'MANGA', label: 'Manga' },
    { id: 'MANHWA', label: 'Manhwa' },
    { id: 'MANHUA', label: 'Manhua' },
    { id: 'ANIME', label: 'Anime' },
  ],
};

const previewItems: readonly OrganizerMove[] = [
  { action: 'move', destination: 'Tobirink / Manga / À lire', id: 'bookmark-1', title: 'Chainsaw Man — chapitre 196' },
  { action: 'move', destination: 'Tobirink / Anime / À regarder', id: 'bookmark-2', title: 'Frieren — épisode 24' },
  { action: 'keep', destination: 'Tobirink / Manga / Terminés', id: 'bookmark-3', title: 'Death Note' },
];

function isState(value: string): value is SettingsState {
  return settingsStates.some((state) => state === value);
}

function updateFolder(tree: OrganizerFolder, id: string, update: (folder: OrganizerFolder) => OrganizerFolder): OrganizerFolder {
  if (tree.id === id) return update(tree);
  return { ...tree, children: tree.children.map((child) => updateFolder(child, id, update)) };
}

function removeFolder(tree: OrganizerFolder, id: string): OrganizerFolder {
  return {
    ...tree,
    children: tree.children
      .filter((child) => child.id !== id)
      .map((child) => removeFolder(child, id)),
  };
}

function reorderSiblings(tree: OrganizerFolder, sourceId: string, targetId: string): OrganizerFolder {
  const sourceIndex = tree.children.findIndex((child) => child.id === sourceId);
  const targetIndex = tree.children.findIndex((child) => child.id === targetId);
  if (sourceIndex !== -1 && targetIndex !== -1) {
    const children = [...tree.children];
    const [source] = children.splice(sourceIndex, 1);
    if (!source) return tree;
    children.splice(targetIndex, 0, source);
    return { ...tree, children };
  }
  return { ...tree, children: tree.children.map((child) => reorderSiblings(child, sourceId, targetId)) };
}

function moveSibling(tree: OrganizerFolder, id: string, direction: 'down' | 'up'): OrganizerFolder {
  const index = tree.children.findIndex((child) => child.id === id);
  if (index !== -1) {
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= tree.children.length) return tree;
    const children = [...tree.children];
    [children[index], children[nextIndex]] = [children[nextIndex]!, children[index]!];
    return { ...tree, children };
  }
  return { ...tree, children: tree.children.map((child) => moveSibling(child, id, direction)) };
}

function SettingsDemo({ state }: { state: SettingsState }) {
  const [tree, setTree] = useState<OrganizerFolder>(initialTree);
  const [previewFresh, setPreviewFresh] = useState(false);
  const [message, setMessage] = useState('');
  const nextFolder = useRef(1);

  if (state === 'loading' || state === 'error' || state === 'blocked') {
    return <Settings onRetry={() => setMessage('Nouvel essai demandé')} state={state} />;
  }

  const changeTree = (update: (current: OrganizerFolder) => OrganizerFolder) => {
    setTree(update);
    setPreviewFresh(false);
  };
  const addFolder = (parentId: string) => {
    const id = 'new-folder-' + nextFolder.current;
    nextFolder.current += 1;
    changeTree((current) => updateFolder(current, parentId, (parent) => ({
      ...parent,
      children: [...parent.children, { children: [], conditions: { ...emptyConditions }, id, name: 'Nouveau dossier' }],
    })));
    return id;
  };

  return (
    <>
      <Settings
        configurationValid
        filterOptions={filterOptions}
        onAddFolder={addFolder}
        onApplyPreview={() => setMessage('Tri demandé')}
        onConditionsChange={(id, conditions) => changeTree((current) => updateFolder(current, id, (folder) => ({ ...folder, conditions })))}
        onFolderNameChange={(id, name) => changeTree((current) => updateFolder(current, id, (folder) => ({ ...folder, name })))}
        onMoveFolder={(id, direction) => changeTree((current) => moveSibling(current, id, direction))}
        onRemoveFolder={(id) => changeTree((current) => removeFolder(current, id))}
        onReorderFolder={(sourceId, targetId) => changeTree((current) => reorderSiblings(current, sourceId, targetId))}
        onRequestPreview={() => { setPreviewFresh(true); setMessage('Aperçu calculé'); }}
        onRestore={() => { setTree(initialTree); setPreviewFresh(false); setMessage('Organisation restaurée'); }}
        previewFresh={previewFresh}
        previewItems={previewItems}
        state={state}
        tree={tree}
      />
      <p aria-live="polite" className={styles.srOnly}>{message}</p>
    </>
  );
}

const settingsPreview = definePreview({
  id: 'settings',
  title: 'Réglages complets',
  category: 'Surfaces',
  level: 'surface',
  purpose: 'Organiser les favoris avec un arbre ordonné et vérifier chaque déplacement avant application.',
  presentation: 'page',
  variants: [...settingsVariants],
  states: [...settingsStates],
  fixtures: ['Arbre récursif · filtres réels · aperçu invalidable'],
  sources: [
    { label: 'API publique', path: 'entrypoints/options/index.ts' },
    { label: 'Contrat de surface', path: 'entrypoints/options/settings.contract.ts' },
    { label: 'Modèle organisateur', path: 'entrypoints/options/organizer.types.ts' },
    { label: 'Surface publique', path: 'entrypoints/options/Settings.tsx' },
    { label: 'Coque organisateur', path: 'entrypoints/options/OrganizerSettings.tsx' },
    { label: 'Éditeur récursif', path: 'entrypoints/options/OrganizerFolderEditor.tsx' },
    { label: 'Styles', path: 'entrypoints/options/Settings.module.css' },
    { label: 'Preview', path: 'entrypoints/options/Settings.preview.tsx' },
    { label: 'Tests', path: 'entrypoints/options/Settings.test.tsx' },
  ],
  dependencies: ['Button', 'Dialog', 'FeedbackState', 'Icon', 'Status', 'TobirinkLogo'],
  accessibility: [
    'L’arbre expose ses niveaux, groupes et noms éditables',
    'Chaque filtre expose son état avec aria-pressed',
    'Le tri au clavier utilise les flèches haut et bas sur la poignée',
    'La restauration exige une confirmation Dialog',
  ],
  usage: "import { Settings } from '@tobirink/extension/entrypoints/options';",
  render: ({ state }) => (
    <section className={styles.preview}>
      <SettingsDemo key={state} state={isState(state) ? state : 'ready'} />
    </section>
  ),
});

export default settingsPreview;
