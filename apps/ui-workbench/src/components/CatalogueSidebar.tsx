import type { PreviewCategory } from '@tobirink/ui/preview-contract';
import type { CatalogueItem } from '../catalog/types';

const categories: readonly PreviewCategory[] = ['Fondations', 'Primitives', 'Métier', 'Surfaces'];

interface CatalogueSidebarProps {
  activeCategory: PreviewCategory | 'Tout';
  items: readonly CatalogueItem[];
  onCategoryChange: (category: PreviewCategory | 'Tout') => void;
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
  query: string;
  selectedId: string;
  totalCount: number;
}

export function CatalogueSidebar({
  activeCategory,
  items,
  onCategoryChange,
  onQueryChange,
  onSelect,
  query,
  selectedId,
  totalCount,
}: CatalogueSidebarProps) {
  return (
    <aside className="catalogue" aria-label="Catalogue des composants">
      <div className="catalogue__heading">
        <p className="eyebrow">Inventaire UI</p>
        <div className="catalogue__title-row">
          <h1>Atelier</h1>
          <span className="count-badge" aria-label={`${totalCount} éléments`}>{totalCount}</span>
        </div>
        <p className="muted">Chaque pièce, avant l’assemblage.</p>
      </div>

      <label className="search-field">
        <span className="sr-only">Rechercher un composant</span>
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Rechercher…"
        />
        <kbd>⌘ K</kbd>
      </label>

      <div className="category-tabs" aria-label="Filtrer par catégorie">
        {(['Tout', ...categories] as const).map((category) => (
          <button
            aria-pressed={category === activeCategory}
            className={category === activeCategory ? 'is-active' : ''}
            key={category}
            type="button"
            onClick={() => onCategoryChange(category)}
          >
            {category}
          </button>
        ))}
      </div>

      <nav className="catalogue__list" aria-label="Éléments du catalogue">
        {items.length === 0 ? (
          <p className="empty-message">Aucun résultat pour ce filtre.</p>
        ) : categories.map((category) => {
          const categoryItems = items.filter((item) => item.category === category);
          if (categoryItems.length === 0) return null;
          return (
            <section className="catalogue-group" key={category}>
              <h2>{category}<span>{categoryItems.length}</span></h2>
              {categoryItems.map((item) => (
                <button
                  aria-current={selectedId === item.id ? 'page' : undefined}
                  className={`catalogue-item ${selectedId === item.id ? 'is-selected' : ''}`}
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                >
                  <span className={`status-dot status-dot--${item.status}`} aria-hidden="true" />
                  <span>{item.title}</span>
                  <span className="catalogue-item__arrow" aria-hidden="true">›</span>
                </button>
              ))}
            </section>
          );
        })}
      </nav>

      <div className="catalogue__legend">
        <span><i className="status-dot status-dot--implemented" />Implémenté</span>
        <span><i className="status-dot status-dot--planned" />Planifié</span>
      </div>
    </aside>
  );
}
