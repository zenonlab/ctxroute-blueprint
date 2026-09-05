import { definePreview } from '../../preview-contract';
import { SearchField, searchFieldStates, searchFieldVariants } from './index';
import type { SearchFieldState } from './index';
import '../../tokens/color.css';
import '../../tokens/layout.css';
import '../../tokens/effects.css';
import styles from './SearchField.module.css';

function isSearchFieldState(value: string): value is SearchFieldState {
  return searchFieldStates.some((state) => state === value);
}

const searchFieldPreview = definePreview({
  id: 'search-field',
  title: 'SearchField',
  category: 'Primitives',
  level: 'primitive',
  purpose: 'Rechercher avec un contrôle natif compact et immédiatement identifiable.',
  variants: [...searchFieldVariants],
  states: [...searchFieldStates],
  fixtures: ['Frieren'],
  sources: [
    { label: 'API publique', path: 'components/search-field/index.ts' },
    { label: 'Contrat', path: 'components/search-field/search-field.contract.ts' },
    { label: 'Implémentation', path: 'components/search-field/SearchField.tsx' },
    { label: 'Styles', path: 'components/search-field/SearchField.module.css' },
    { label: 'Preview', path: 'components/search-field/SearchField.preview.tsx' },
    { label: 'Tests', path: 'components/search-field/SearchField.test.tsx' },
  ],
  dependencies: ['Icon', 'color tokens', 'layout tokens', 'effects tokens', 'preview-contract'],
  accessibility: [
    'Le label natif donne un nom accessible au champ de recherche',
    'Le type search expose la sémantique searchbox',
    'Le focus reste visible sur la bordure et l’icône sans double contour',
    'L’état disabled reste natif et perceptible',
  ],
  usage: `import { SearchField } from '@tobirink/ui';`,
  render: ({ state }) => {
    const selectedState: SearchFieldState = isSearchFieldState(state) ? state : 'empty';
    const hasValue = selectedState === 'filled';

    return (
      <section className={styles.preview} data-state={selectedState}>
        <header className={styles.previewHeader}>
          <div>
            <p className={styles.eyebrow}>Primitive · Recherche</p>
            <h3>Trouver sans détour</h3>
          </div>
          <span className={styles.index}>HTML / search</span>
        </header>

        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Composition</h4>
          <div className={styles.sample}>
            <SearchField
              defaultValue={hasValue ? 'Frieren' : undefined}
              disabled={selectedState === 'disabled'}
              label="Rechercher dans Tobirink"
              placeholder="Rechercher…"
            />
          </div>
        </section>

        <p className={styles.rule}>Un seul usage : rechercher. La bordure se précise et l’icône s’allume au focus.</p>
      </section>
    );
  },
});

export default searchFieldPreview;
