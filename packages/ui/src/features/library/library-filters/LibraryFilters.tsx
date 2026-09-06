import { FacetSelect } from '../../../components/facet-select';
import { SearchField } from '../../../components/search-field';
import type {
  LibraryFilterOptions,
  LibraryFiltersValue,
  LibraryFiltersVariant,
} from './library-filters.contract';
import styles from './LibraryFilters.module.css';

export interface LibraryFiltersProps {
  disabled?: boolean;
  onChange: (value: LibraryFiltersValue) => void;
  options: LibraryFilterOptions;
  value: LibraryFiltersValue;
  variant?: LibraryFiltersVariant;
}

export function LibraryFilters({
  disabled = false,
  onChange,
  options,
  value,
  variant = 'library',
}: LibraryFiltersProps) {
  return (
    <section aria-label="Recherche et filtres de la bibliothèque" className={styles.root} data-variant={variant}>
      <SearchField
        autoComplete="off"
        className={styles.query}
        disabled={disabled}
        label="Rechercher dans la bibliothèque"
        onChange={(event) => onChange({ ...value, query: event.currentTarget.value })}
        placeholder="Rechercher…"
        value={value.query}
      />

      <div aria-label="Facettes" className={styles.facets} role="group">
        {options.type.length > 0 ? (
          <FacetSelect
            disabled={disabled}
            label="Type"
            onChange={(type) => onChange({ ...value, type })}
            options={options.type}
            value={value.type}
          />
        ) : null}
        {options.status.length > 0 ? (
          <FacetSelect
            disabled={disabled}
            label="Statut"
            onChange={(status) => onChange({ ...value, status })}
            options={options.status}
            value={value.status}
          />
        ) : null}
        {options.progress.length > 0 ? (
          <FacetSelect
            disabled={disabled}
            label="Progression"
            onChange={(progress) => onChange({ ...value, progress })}
            options={options.progress}
            value={value.progress}
          />
        ) : null}
      </div>
    </section>
  );
}
