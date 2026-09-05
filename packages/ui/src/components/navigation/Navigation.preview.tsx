import { useState } from 'react';
import { definePreview } from '../../preview-contract';
import '../../tokens/color.css';
import '../../tokens/layout.css';
import '../../tokens/effects.css';
import { Navigation, navigationStates, navigationVariants } from './index';
import type { NavigationState, NavigationVariant } from './index';
import styles from './Navigation.module.css';

const linkItems = [
  { href: '#home', icon: 'house' as const, id: 'home', label: 'Accueil' },
  { href: '#library', icon: 'library-big' as const, id: 'library', label: 'Bibliothèque' },
  { href: '#agenda', icon: 'calendar-days' as const, id: 'agenda', label: 'Agenda' },
];

const tabItems = [
  { id: 'summary', label: 'Résumé' },
  { id: 'sources', label: 'Sources' },
  { id: 'details', label: 'Détails' },
];

function isVariant(value: string): value is NavigationVariant {
  return navigationVariants.some((variant) => variant === value);
}

function isState(value: string): value is NavigationState {
  return navigationStates.some((state) => state === value);
}

function NavigationDemo({ state, variant }: { state: NavigationState; variant: NavigationVariant }) {
  const [activeId, setActiveId] = useState(variant === 'tabs' ? 'summary' : 'library');

  return (
    <section className={styles.preview} data-state={state}>
      <header className={styles.previewHeader}>
        <div>
          <p className={styles.eyebrow}>Primitive · Orientation</p>
          <h3>Une position active, trois formats</h3>
        </div>
        <span className={styles.index}>FavLib / nav</span>
      </header>
      <div className={styles.stage}>
        {variant === 'tabs' ? (
          <Navigation activeId={activeId} items={tabItems} kind="tabs" label="Sections de l’œuvre" onActiveChange={setActiveId} variant="tabs" />
        ) : (
          <Navigation activeId={activeId} items={linkItems} label="Navigation principale" variant={variant} />
        )}
      </div>
      <p className={styles.rule}>Le même accent indique la position, sans badge ni texte d’état supplémentaire.</p>
    </section>
  );
}

const navigationPreview = definePreview({
  id: 'navigation',
  title: 'Navigation',
  category: 'Primitives',
  level: 'primitive',
  purpose: 'Partager une convention active entre liens, tabs et surfaces compactes.',
  variants: [...navigationVariants],
  states: [...navigationStates],
  fixtures: [linkItems, tabItems],
  sources: [
    { label: 'API publique', path: 'components/navigation/index.ts' },
    { label: 'Contrat', path: 'components/navigation/navigation.contract.ts' },
    { label: 'Implémentation', path: 'components/navigation/Navigation.tsx' },
    { label: 'Styles', path: 'components/navigation/Navigation.module.css' },
    { label: 'Preview', path: 'components/navigation/Navigation.preview.tsx' },
    { label: 'Tests', path: 'components/navigation/Navigation.test.tsx' },
  ],
  dependencies: ['Icon', 'color tokens', 'layout tokens', 'effects tokens'],
  accessibility: [
    'Les liens actifs utilisent aria-current=page',
    'Les tabs utilisent aria-selected et un seul tabIndex à zéro',
    'Flèches, Home et End déplacent le focus sans déclencher de sélection',
  ],
  usage: `import { Navigation } from '@tobirink/ui/components/navigation';`,
  render: ({ state, variant }) => {
    const selectedState = isState(state) ? state : 'default';
    const selectedVariant = isVariant(variant) ? variant : 'primary';
    return <NavigationDemo key={`${selectedVariant}-${selectedState}`} state={selectedState} variant={selectedVariant} />;
  },
});

export default navigationPreview;
