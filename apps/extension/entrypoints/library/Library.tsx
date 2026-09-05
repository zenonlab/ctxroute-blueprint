import { Button, FeedbackState, MemberNavigation, Status, WorkCard } from '@tobirink/ui';
import type { MemberNavigationConfig } from '@tobirink/ui';
import { LibraryFilters } from '../../../../packages/ui/src/features/library/library-filters';
import type { LibraryFilterOptions, LibraryFiltersValue } from '../../../../packages/ui/src/features/library/library-filters';
import type { LibraryState, LibraryVariant, LibraryWork } from './library.contract';
import styles from './Library.module.css';

export interface LibraryProps {
  filterOptions: LibraryFilterOptions;
  filters: LibraryFiltersValue;
  hasMore?: boolean;
  items: readonly LibraryWork[];
  navigation: MemberNavigationConfig;
  onChangeFilters: (value: LibraryFiltersValue) => void;
  onDownloadExtension?: () => void;
  onLoadMore: () => void;
  onOpenRecovery: () => void;
  onRetry: () => void;
  state: LibraryState;
  variant?: LibraryVariant;
}

export function Library({
  filterOptions,
  filters,
  hasMore = false,
  items,
  navigation,
  onChangeFilters,
  onDownloadExtension,
  onLoadMore,
  onOpenRecovery,
  onRetry,
  state,
  variant = 'library',
}: LibraryProps) {
  const usable = state === 'ready' || state === 'review' || state === 'partial' || state === 'offline';

  return (
    <MemberNavigation {...navigation}>
      <main aria-label="Bibliothèque" className={styles.library} data-state={state} data-variant={variant}>
        {state === 'loading' ? (
          <FeedbackState
            className={styles.centeredState}
            description="Lecture des œuvres enregistrées sur cet appareil."
            kind="loading"
            layout="centered"
            title="Préparation de la bibliothèque…"
          />
        ) : null}

        {state === 'empty' ? (
          <FeedbackState
            action={onDownloadExtension
              ? <Button icon="download" onClick={onDownloadExtension} variant="primary">Télécharger l’extension</Button>
              : undefined}
            className={styles.centeredState}
            description="Importez vos favoris ou ajoutez une première œuvre."
            icon="library-big"
            kind="empty"
            layout="centered"
            title="Votre bibliothèque est vide"
          />
        ) : null}

        {state === 'error' ? (
          <FeedbackState
            action={<Button icon="refresh-cw" onClick={onRetry}>Réessayer</Button>}
            className={styles.centeredState}
            description="Les œuvres déjà conservées ne sont pas supprimées."
            kind="error"
            layout="centered"
            recoverable
            title="Lecture interrompue"
          />
        ) : null}

        {state === 'blocked' ? (
          <FeedbackState
            action={<Button icon="rotate-ccw" onClick={onOpenRecovery}>Ouvrir la récupération</Button>}
            className={styles.centeredState}
            description="La migration locale doit être reprise avant toute modification."
            kind="error"
            layout="centered"
            recoverable
            title="Migration locale interrompue"
          />
        ) : null}

        {usable ? (
          <>
            <LibraryFilters
              onChange={onChangeFilters}
              options={filterOptions}
              value={filters}
            />

            {state === 'partial' ? <Status tone="accent">Métadonnées incomplètes · données locales disponibles</Status> : null}
            {state === 'offline' ? <Status tone="warning">Hors ligne · recherche et progression locale disponibles</Status> : null}

            {items.length === 0 ? (
              <FeedbackState className={styles.centeredState} description="Modifiez la recherche ou retirez une facette." icon="search" kind="empty" layout="centered" title="Aucun résultat" />
            ) : (
              <section aria-label="Œuvres" className={styles.grid}>
                {items.map((item) => (
                  <WorkCard
                    coverAlt={item.coverAlt}
                    coverSrc={item.coverSrc}
                    context={item.mediaType}
                    detail={item.source}
                    href={`#work-${item.id}`}
                    indicator={item.progress}
                    key={item.id}
                    title={item.title}
                    variant="library"
                  />
                ))}
              </section>
            )}

            {hasMore ? (
              <div className={styles.pagination}>
                <Button icon="chevron-down" onClick={onLoadMore}>Voir plus</Button>
              </div>
            ) : null}
          </>
        ) : null}
      </main>
    </MemberNavigation>
  );
}
