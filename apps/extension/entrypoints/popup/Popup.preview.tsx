import { useState } from 'react';
import { definePreview } from '@tobirink/ui/preview-contract';
import '../../../../packages/ui/src/tokens/color.css';
import '../../../../packages/ui/src/tokens/layout.css';
import '../../../../packages/ui/src/tokens/effects.css';
import { Popup, popupStates, popupVariants } from './index';
import type { PopupAgendaModel, PopupContinuationsModel, PopupPageModel, PopupPreferencesModel, PopupState, PopupVariant } from './index';
import styles from './Popup.module.css';

const pageWork = {
  href: '#page-source',
  indicator: '7 / 12',
  mediaType: 'Manga',
  source: 'Source détectée',
  title: 'Les Carnets de l’Apothicaire',
};

const agendaItems = [
  { href: '#agenda-one', indicator: '5 sept.', mediaType: 'Officielle', source: 'Chapitre 141 · Éditeur', title: 'Frieren' },
  { href: '#agenda-two', indicator: '12 sept.', mediaType: 'Estimée', source: 'Épisode 18 · Catalogue', title: 'Dandadan' },
];

const continuationItems = [
  { href: '#continue-one', indicator: '37 / 120', mediaType: 'Manga', source: 'mangadex.org', title: 'Frieren' },
  { href: '#continue-two', indicator: '8 / 12', mediaType: 'Anime', source: 'crunchyroll.com', title: 'Dandadan' },
];

function isVariant(value: string): value is PopupVariant {
  return popupVariants.some((variant) => variant === value);
}

function PopupDemo({ state, variant }: { state: PopupState; variant: PopupVariant }) {
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [favoritesEnabled, setFavoritesEnabled] = useState(false);
  const [observeNavigation, setObserveNavigation] = useState(false);
  const page: PopupPageModel = state === 'ready'
    ? { state, work: pageWork }
    : { state };
  const agenda: PopupAgendaModel = state === 'ready'
    ? { items: agendaItems, state }
    : { state };
  const continuations: PopupContinuationsModel = state === 'ready'
    ? { items: continuationItems, state }
    : state === 'empty'
      ? { items: [], state: 'ready' }
      : { state };
  const preferences: PopupPreferencesModel = state === 'loading' || state === 'error' || state === 'blocked'
    ? { state }
    : {
      items: [
        {
          description: 'Mettre à jour un favori uniquement après vérification.',
          enabled: favoritesEnabled,
          id: 'popup-auto-favorites',
          label: 'Mise à jour des favoris',
        },
        {
          description: 'Déduire la progression sur les pages compatibles.',
          enabled: observeNavigation,
          id: 'popup-observe-navigation',
          label: 'Observer la navigation',
        },
        {
          description: 'Afficher les actions Tobirink sur la page active.',
          enabled: assistantEnabled,
          id: 'popup-navigation-assistant',
          label: 'Assistant de navigation',
        },
      ],
      state: 'ready',
    };

  return (
    <Popup
      agenda={agenda}
      connection={{ label: 'Données locales prêtes', tone: 'ready' }}
      continuations={continuations}
      initialPanel={variant}
      onOpenFullSettings={() => undefined}
      onPreferenceChange={(id, enabled) => {
        if (id === 'popup-auto-favorites') setFavoritesEnabled(enabled);
        if (id === 'popup-observe-navigation') setObserveNavigation(enabled);
        if (id === 'popup-navigation-assistant') setAssistantEnabled(enabled);
      }}
      onRetryAgenda={() => undefined}
      onRetryPage={() => undefined}
      page={page}
      preferences={preferences}
    />
  );
}

const popupPreview = definePreview({
  id: 'popup',
  title: 'Menu extension',
  category: 'Surfaces',
  level: 'surface',
  purpose: 'Ouvrir l’œuvre active, reprendre une œuvre interrompue, consulter les sorties et les réglages rapides.',
  presentation: 'popup',
  variants: [...popupVariants],
  states: [...popupStates],
  fixtures: ['Œuvre active 3:2', 'Deux reprises 2:3', 'Deux sorties', 'Préférences rapides'],
  sources: [
    { label: 'API publique', path: 'entrypoints/popup/index.ts' },
    { label: 'Contrat', path: 'entrypoints/popup/popup.contract.ts' },
    { label: 'Surface', path: 'entrypoints/popup/Popup.tsx' },
    { label: 'Styles', path: 'entrypoints/popup/Popup.module.css' },
    { label: 'Preview', path: 'entrypoints/popup/Popup.preview.tsx' },
    { label: 'Tests', path: 'entrypoints/popup/Popup.test.tsx' },
  ],
  dependencies: ['Navigation compact', 'WorkCard', 'FeedbackState', 'Switch', 'Button', 'Icon', 'design tokens'],
  accessibility: [
    'La navigation basse forme une tablist avec sélection annoncée et focus roving',
    'Chaque panneau possède un nom et les contrôles gardent une cible tactile',
  ],
  usage: `import { Popup } from '@tobirink/extension/entrypoints/popup';`,
  render: ({ state, variant }) => (
    <section className={styles.preview}>
      <PopupDemo key={`${variant}-${state}`} state={state === 'loading' || state === 'empty' || state === 'error' || state === 'blocked' ? state : 'ready'} variant={isVariant(variant) ? variant : 'page'} />
    </section>
  ),
});

export default popupPreview;
