import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PreviewCategory } from '@tobirink/ui/preview-contract';
import { catalogue } from './catalog/discovery';
import { CatalogueSidebar } from './components/CatalogueSidebar';
import { PreviewCanvas } from './components/PreviewCanvas';

type MobilePane = 'catalogue' | 'preview';

function initialCatalogueId() {
  if (typeof window !== 'undefined') {
    const requestedId = window.location.hash.slice(1);
    if (catalogue.some((item) => item.id === requestedId)) return requestedId;
  }
  return catalogue[0]?.id ?? '';
}

export function App() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PreviewCategory | 'Tout'>('Tout');
  const [selectedId, setSelectedId] = useState(initialCatalogueId);
  const [variant, setVariant] = useState('default');
  const [previewState, setPreviewState] = useState('default');
  const [mobilePane, setMobilePane] = useState<MobilePane>('preview');

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('fr');
    return catalogue.filter((item) => {
      const matchesCategory = category === 'Tout' || item.category === category;
      const matchesQuery = normalizedQuery.length === 0
        || `${item.title} ${item.purpose}`.toLocaleLowerCase('fr').includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [category, query]);

  const selectedItem = catalogue.find((item) => item.id === selectedId) ?? catalogue[0];

  const selectItem = useCallback((id: string, syncHash = true) => {
    const item = catalogue.find((candidate) => candidate.id === id);
    if (!item) return;
    setSelectedId(id);
    setVariant(item.variants[0] ?? 'default');
    setPreviewState(item.states[0] ?? 'default');
    setMobilePane('preview');
    if (syncHash && typeof window !== 'undefined' && window.location.hash !== `#${id}`) {
      window.history.replaceState(null, '', `#${id}`);
    }
  }, []);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.search-field input')?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    const selectFromHash = () => selectItem(window.location.hash.slice(1), false);
    window.addEventListener('hashchange', selectFromHash);
    return () => window.removeEventListener('hashchange', selectFromHash);
  }, [selectItem]);

  if (!selectedItem) {
    return <p>Le catalogue UI est vide.</p>;
  }

  return (
    <div className="workbench">
      <div className="mobile-nav" aria-label="Panneau affiché">
        {(['catalogue', 'preview'] as const).map((pane) => (
          <button
            aria-pressed={mobilePane === pane}
            className={mobilePane === pane ? 'is-active' : ''}
            key={pane}
            type="button"
            onClick={() => setMobilePane(pane)}
          >
            {pane === 'catalogue' ? 'Catalogue' : 'Aperçu'}
          </button>
        ))}
      </div>
      <div className={`pane pane--catalogue ${mobilePane === 'catalogue' ? 'is-mobile-active' : ''}`}>
        <CatalogueSidebar
          activeCategory={category}
          items={visibleItems}
          onCategoryChange={setCategory}
          onQueryChange={setQuery}
          onSelect={selectItem}
          query={query}
          selectedId={selectedItem.id}
          totalCount={catalogue.length}
        />
      </div>
      <div className={`pane pane--preview ${mobilePane === 'preview' ? 'is-mobile-active' : ''}`}>
        <PreviewCanvas
          item={selectedItem}
          onStateChange={setPreviewState}
          onVariantChange={setVariant}
          state={previewState}
          variant={variant}
        />
      </div>
    </div>
  );
}
