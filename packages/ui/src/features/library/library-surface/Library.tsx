import { Button } from '../../../components/button';
import { FeedbackState } from '../../../components/feedback-state';
import { Status } from '../../../components/status';
import { MemberNavigation } from '../../navigation/member-navigation';
import type { MemberNavigationConfig } from '../../navigation/member-navigation';
import { LibraryFilters } from '../library-filters';
import type { LibraryFilterOptions, LibraryFiltersValue } from '../library-filters';
import { WorkCard } from '../work-card';
import type { LibraryState, LibraryStatistics, LibraryVariant, LibraryWork } from './library-surface.contract';
import styles from './Library.module.css';

export interface LibraryProps {
  extensionRequired?: boolean;
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
  statistics?: LibraryStatistics;
  variant?: LibraryVariant;
}

export function Library({
  extensionRequired = false,
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
          <FeedbackState className={styles.centeredState} description="Lecture des œuvres enregistrées sur cet appareil." kind="loading" layout="centered" title="Préparation de la bibliothèque…" />
        ) : null}

        {state === 'empty' ? (
          <FeedbackState
            action={extensionRequired && onDownloadExtension ? <Button icon="download" onClick={onDownloadExtension} variant="primary">Télécharger l’extension</Button> : undefined}
            className={styles.centeredState}
            description={extensionRequired ? 'Installez l’extension TobiRink pour retrouver automatiquement les œuvres de vos favoris.' : 'Aucune œuvre compatible n’a été trouvée dans vos favoris.'}
            icon="library-big"
            kind="empty"
            layout="centered"
            title={extensionRequired ? 'Extension TobiRink requise' : 'Aucune œuvre trouvée'}
          />
        ) : null}

        {state === 'error' ? (
          <FeedbackState action={<Button icon="refresh-cw" onClick={onRetry}>Réessayer</Button>} className={styles.centeredState} description="Les œuvres déjà conservées ne sont pas supprimées." kind="error" layout="centered" recoverable title="Lecture interrompue" />
        ) : null}

        {state === 'blocked' ? (
          <FeedbackState action={<Button icon="rotate-ccw" onClick={onOpenRecovery}>Ouvrir la récupération</Button>} className={styles.centeredState} description="Vos données doivent être réparées avant de continuer." kind="error" layout="centered" recoverable title="Bibliothèque indisponible" />
        ) : null}

        {usable ? (
          <>
            <LibraryFilters onChange={onChangeFilters} options={filterOptions} value={filters} />
            {state === 'partial' ? <Status tone="accent">Métadonnées incomplètes · données enregistrées disponibles</Status> : null}
            {state === 'offline' ? <Status tone="warning">Hors ligne · recherche et progression disponibles</Status> : null}
            {items.length === 0 ? (
              <FeedbackState className={styles.centeredState} description="Modifiez la recherche ou retirez une facette." icon="search" kind="empty" layout="centered" title="Aucun résultat" />
            ) : (
              <section aria-label="Œuvres" className={styles.grid}>
                {items.map((item) => (
                  <WorkCard
                    coverAlt={item.coverAlt}
                    coverSrc={item.coverSrc}
                    coverFallbackSrc={item.coverFallbackSrc}
                    context={item.mediaType}
                    detail={item.detail ?? item.source}
                    href={item.href}
                    indicator={item.progress}
                    key={item.id}
                    title={item.title}
                    variant="library"
                  />
                ))}
              </section>
            )}
            {hasMore ? <div className={styles.pagination}><Button icon="chevron-down" onClick={onLoadMore}>Voir plus</Button></div> : null}
          </>
        ) : null}
      </main>
    </MemberNavigation>
  );
}
