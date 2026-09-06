import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { TobirinkLogo } from '../../../brand';
import { Button } from '../../../components/button';
import { Navigation } from '../../../components/navigation';
import { SearchField } from '../../../components/search-field';
import { ReviewResolver } from '../../review/review-resolver';
import type { MemberNavigationItemId, MemberReviewConfig } from './member-navigation.contract';
import styles from './MemberNavigation.module.css';

export interface MemberNavigationConfig {
  activeId?: MemberNavigationItemId;
  logoSrc?: string;
  onSearch: (query: string) => void;
  review: MemberReviewConfig;
  routes?: MemberNavigationRoutes;
}

export interface MemberNavigationRoutes {
  agenda?: string;
  brand?: string;
  home?: string;
  library?: string;
}

export interface MemberNavigationProps extends MemberNavigationConfig {
  children: ReactNode;
}

export function MemberNavigation({
  activeId,
  children,
  logoSrc,
  onSearch,
  review,
  routes,
}: MemberNavigationProps) {
  const [query, setQuery] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewCountId = useId();
  const reviewPanelId = useId();
  const reviewPanelTitleId = useId();
  const reviewTriggerRef = useRef<HTMLDivElement>(null);
  const reviewPanelRef = useRef<HTMLDivElement>(null);
  const normalizedCount = Number.isFinite(review.count) ? Math.max(0, Math.trunc(review.count)) : 0;
  const reviewIsEmpty = review.resolver.state === 'empty';
  const navigationItems = [
    { href: routes?.home ?? '#home', icon: 'house' as const, id: 'home', label: 'Accueil' },
    { href: routes?.library ?? '#library', icon: 'library-big' as const, id: 'library', label: 'Bibliothèque' },
    { href: routes?.agenda ?? '#agenda', icon: 'calendar-days' as const, id: 'agenda', label: 'Agenda' },
  ];

  useEffect(() => {
    if (!reviewOpen) return;
    reviewPanelRef.current?.focus();

    const closeAndRestoreFocus = () => {
      if (review.resolver.busy) return;
      setReviewOpen(false);
      reviewTriggerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !reviewTriggerRef.current?.contains(target)) closeAndRestoreFocus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeAndRestoreFocus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [review.resolver.busy, reviewOpen]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch(query.trim());
  };

  return (
    <div className={styles.shell}>
      <header className={styles.siteHeader}>
        <div className={styles.headerInner}>
          <a className={styles.brand} href={routes?.brand ?? routes?.home ?? '#home'}>
            <TobirinkLogo className={styles.brandLogo} src={logoSrc} />
            <span>Tobirink</span>
          </a>

          <div className={styles.primary}>
            <Navigation activeId={activeId ?? ''} items={navigationItems} label="Navigation principale" variant="primary" />
          </div>

          <div className={styles.headerCenter}>
            <form aria-label="Recherche globale" className={styles.search} onSubmit={submitSearch} role="search">
              <SearchField
                label="Rechercher dans Tobirink"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Rechercher…"
                value={query}
              />
            </form>

            <div className={styles.reviewTrigger} ref={reviewTriggerRef}>
              <Button
                aria-controls={reviewPanelId}
                aria-describedby={reviewCountId}
                aria-expanded={reviewOpen}
                aria-haspopup="dialog"
                aria-label="Correspondances à vérifier"
                className={styles.reviewButton}
                icon="bell"
                iconOnly
                onClick={(event) => {
                  event.currentTarget.focus();
                  setReviewOpen((open) => !open);
                }}
                variant="quiet"
              />
              {normalizedCount > 0 ? (
                <span aria-hidden="true" className={styles.reviewCount}>{normalizedCount > 99 ? '99+' : normalizedCount}</span>
              ) : null}
              <span className={styles.srOnly} id={reviewCountId}>
                {normalizedCount} {normalizedCount > 1 ? 'correspondances en attente' : 'correspondance en attente'}
              </span>

              {reviewOpen ? (
                <div
                  aria-label={reviewIsEmpty ? 'Correspondances à vérifier' : undefined}
                  aria-labelledby={reviewIsEmpty ? undefined : reviewPanelTitleId}
                  className={styles.reviewPanel}
                  data-review-state={review.resolver.state}
                  id={reviewPanelId}
                  ref={reviewPanelRef}
                  role="dialog"
                  tabIndex={-1}
                >
                  <div className={styles.reviewPanelBody}>
                    {reviewIsEmpty ? null : (
                      <header className={styles.reviewPanelHeader}>
                        <p>Review</p>
                        <h2 id={reviewPanelTitleId}>Correspondances à vérifier</h2>
                      </header>
                    )}
                    <ReviewResolver {...review.resolver} />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className={styles.content}>{children}</div>

      <div className={styles.compact}>
        <Navigation activeId={activeId ?? ''} items={navigationItems} label="Navigation mobile" variant="compact" />
      </div>
    </div>
  );
}
