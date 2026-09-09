import { FacetSelect } from '../../../components/facet-select';
import { SearchField } from '../../../components/search-field';
import type {
  LibraryFilterOptions,
  LibraryFiltersValue,
  LibraryFiltersVariant,
} from './library-filters.contract';
import { librarySortValues } from './library-filters.contract';
import styles from './LibraryFilters.module.css';

export interface LibraryFiltersProps {
  disabled?: boolean;
  onChange: (value: LibraryFiltersValue) => void;
  options: LibraryFilterOptions;
  value: LibraryFiltersValue;
  variant?: LibraryFiltersVariant;
}

function isLibrarySort(value: string): value is LibraryFiltersValue['sort'] {
  return librarySortValues.some((sort) => sort === value);
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
        <label className={styles.sortField}>
          <span>Tri</span>
          <select disabled={disabled} onChange={(event) => { if (isLibrarySort(event.currentTarget.value)) onChange({ ...value, sort: event.currentTarget.value }); }} value={value.sort}>
            <option value="ADDED_DESC">Ajout récent</option>
            <option value="TITLE_ASC">Titre A–Z</option>
            <option value="TITLE_DESC">Titre Z–A</option>
            <option value="YEAR_DESC">Année récente</option>
            <option value="PROGRESS_DESC">Progression</option>
            <option value="POPULARITY_DESC">Popularité</option>
          </select>
        </label>
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
        {options.genre.length > 0 ? (
          <FacetSelect disabled={disabled} label="Genre" onChange={(genre) => onChange({ ...value, genre })} options={options.genre} value={value.genre} />
        ) : null}
        {options.format.length > 0 ? (
          <FacetSelect disabled={disabled} label="Format" onChange={(format) => onChange({ ...value, format })} options={options.format} value={value.format} />
        ) : null}
        {options.year.length > 0 ? (
          <FacetSelect disabled={disabled} label="Année" onChange={(year) => onChange({ ...value, year })} options={options.year} value={value.year} />
        ) : null}
        {options.source.length > 0 ? (
          <FacetSelect disabled={disabled} label="Source" onChange={(source) => onChange({ ...value, source })} options={options.source} value={value.source} />
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
