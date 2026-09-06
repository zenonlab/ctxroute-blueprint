import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentProps } from 'react';
import { emptyLibraryFilters } from '../../../packages/ui/src/features/library/library-filters';
import type { LibraryFiltersValue } from '../../../packages/ui/src/features/library/library-filters';
import { Agenda } from '../entrypoints/agenda';
import { Library } from '../entrypoints/library';
import { Settings } from '../entrypoints/options';
import { Popup } from '../entrypoints/popup';
import type { PopupWork } from '../entrypoints/popup';
import { Review } from '../entrypoints/review';
import type { NavigationTarget } from './messages';
import { readLibraryPageMessage, readLibrarySearchMessage, readPopupContextMessage, sendExtensionMessage } from './messages';
import type { LibraryPageResponse } from './messages';
import { useLocalAgenda } from './use-local-agenda';
import { useLocalOrganizerSettings } from './use-local-organizer-settings';
import { useLocalReviewNavigation } from './use-local-review-navigation';

export type ExtensionSurfaceName = 'agenda' | 'library' | 'options' | 'popup' | 'review';

function open(target: NavigationTarget) {
  void sendExtensionMessage({ target, type: 'navigation.open', version: 1 });
}

function LibrarySurface() {
  const initialQuery = typeof window === 'undefined' ? '' : new URL(window.location.href).searchParams.get('query')?.trim() ?? '';
  const [filters, setFilters] = useState<LibraryFiltersValue>({ ...emptyLibraryFilters, query: initialQuery });
  const [loadKey, setLoadKey] = useState(0);
  const [model, setModel] = useState<{
    items: Extract<LibraryPageResponse, { ok: true }>['snapshot']['items'];
    loadingMore: boolean;
    nextCursor?: string;
    state: 'empty' | 'error' | 'loading' | 'partial' | 'ready';
  }>({ items: [], loadingMore: false, state: 'loading' });
  const navigation = useLocalReviewNavigation('library');

  const filterOptions = useMemo(() => ({
    progress: [],
    status: [],
    type: (['manga', 'anime'] as const).flatMap((value) => {
      const count = model.items.filter((item) => item.mediaType === value).length;
      return count > 0 ? [{ count, label: value === 'manga' ? 'Manga' : 'Anime', value }] : [];
    }),
  }), [model.items]);
  const visibleItems = useMemo(() => {
    const query = filters.query.trim().toLocaleLowerCase('fr');
    const hasIncludedType = Object.values(filters.type).includes('include');
    return model.items.filter((item) => {
      const typeState = filters.type[item.mediaType];
      const matchesType = typeState !== 'exclude' && (!hasIncludedType || typeState === 'include');
      return matchesType && (query.length === 0 || item.title.toLocaleLowerCase('fr').includes(query));
    });
  }, [filters.query, filters.type, model.items]);

  useEffect(() => {
    let active = true;
    setModel({ items: [], loadingMore: false, state: 'loading' });
    const request = initialQuery ? readLibrarySearchMessage(initialQuery) : readLibraryPageMessage();
    void request.then((snapshot) => {
      if (!active) return;
      if ('truncated' in snapshot) {
        setModel({ items: snapshot.items, loadingMore: false, state: snapshot.items.length > 0 ? 'ready' : 'empty' });
        return;
      }
      setModel({
        items: snapshot.items,
        loadingMore: false,
        nextCursor: snapshot.nextCursor,
        state: snapshot.missingWorkIds.length > 0 ? 'partial' : snapshot.items.length > 0 ? 'ready' : 'empty',
      });
    }).catch(() => {
      if (active) setModel({ items: [], loadingMore: false, state: 'error' });
    });
    return () => { active = false; };
  }, [initialQuery, loadKey]);

  const loadMore = useCallback(() => {
    if (!model.nextCursor || model.loadingMore) return;
    setModel((current) => ({ ...current, loadingMore: true }));
    void readLibraryPageMessage(model.nextCursor).then((snapshot) => {
      setModel((current) => ({
        items: [...current.items, ...snapshot.items],
        loadingMore: false,
        nextCursor: snapshot.nextCursor,
        state: current.state === 'partial' || snapshot.missingWorkIds.length > 0 ? 'partial' : 'ready',
      }));
    }).catch(() => setModel((current) => ({ ...current, loadingMore: false })));
  }, [model.loadingMore, model.nextCursor]);

  return (
    <Library
      filterOptions={filterOptions}
      filters={filters}
      hasMore={Boolean(model.nextCursor)}
      items={visibleItems}
      navigation={navigation}
      onChangeFilters={setFilters}
      onLoadMore={loadMore}
      onOpenRecovery={() => open('settings')}
      onRetry={() => setLoadKey((key) => key + 1)}
      state={model.state}
    />
  );
}

function ReviewSurface() {
  const navigation = useLocalReviewNavigation();
  const resolver = navigation.review.resolver;
  const state = resolver.state === 'loading' || resolver.state === 'empty' || resolver.state === 'partial' || resolver.state === 'error'
    ? resolver.state
    : 'ready';
  return <Review navigation={navigation} onRetry={resolver.onRetry} state={state} />;
}

function AgendaSurface() {
  const navigation = useLocalReviewNavigation('agenda');
  const agenda = useLocalAgenda();
  return <Agenda {...agenda} navigation={navigation} />;
}

function OptionsSurface() {
  const settings = useLocalOrganizerSettings();
  return <Settings {...settings} />;
}

function PopupSurface() {
  const localAgenda = useLocalAgenda();
  const [loadKey, setLoadKey] = useState(0);
  const [model, setModel] = useState<{
    continuations: ComponentProps<typeof Popup>['continuations'];
    page: ComponentProps<typeof Popup>['page'];
  }>({ continuations: { state: 'loading' }, page: { state: 'loading' } });
  const retry = useCallback(() => setLoadKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    setModel({ continuations: { state: 'loading' }, page: { state: 'loading' } });
    void readPopupContextMessage().then((snapshot) => {
      if (!active) return;
      const toWork = (work: (typeof snapshot.continuations)[number]): PopupWork => {
        const item: PopupWork = {
          href: work.url,
          mediaType: work.mediaType,
          source: work.source,
          title: work.title,
        };
        if (work.coverAlt) item.coverAlt = work.coverAlt;
        if (work.coverSrc) item.coverSrc = work.coverSrc;
        if (work.indicator) item.indicator = work.indicator;
        return item;
      };
      setModel({
        continuations: { items: snapshot.continuations.map(toWork), state: 'ready' },
        page: snapshot.active ? { state: 'ready', work: toWork(snapshot.active) } : { state: 'empty' },
      });
    }).catch(() => {
      if (active) setModel({ continuations: { state: 'error' }, page: { state: 'error' } });
    });
    return () => { active = false; };
  }, [loadKey]);

  const agendaItems = localAgenda.days.flatMap((day) => day.releases).map((release): PopupWork => {
    const item = {
      indicator: release.displayDate,
      mediaType: 'Sortie',
      source: `${release.release} · ${release.source}`,
      title: release.title,
    };
    return release.href ? { ...item, href: release.href } : item;
  });
  const agenda = localAgenda.state === 'loading' || localAgenda.state === 'error'
    ? { state: localAgenda.state } as const
    : agendaItems.length > 0
      ? { items: agendaItems, state: 'ready' } as const
      : { state: 'empty' } as const;

  return (
    <Popup
      agenda={agenda}
      connection={model.page.state === 'loading'
        ? { label: 'Lecture du contexte local', tone: 'syncing' }
        : model.page.state === 'error'
          ? { label: 'Lecture locale interrompue', tone: 'error' }
          : { label: 'Données locales prêtes', tone: 'ready' }}
      continuations={model.continuations}
      onOpenFullSettings={() => open('settings')}
      onRetryAgenda={localAgenda.onRetry}
      onRetryPage={retry}
      page={model.page}
      preferences={{ state: 'blocked' }}
    />
  );
}

export function ExtensionSurface({ name }: { name: ExtensionSurfaceName }) {
  if (name === 'popup') {
    return <PopupSurface />;
  }

  if (name === 'library') {
    return <LibrarySurface />;
  }

  if (name === 'review') {
    return <ReviewSurface />;
  }

  if (name === 'agenda') {
    return <AgendaSurface />;
  }

  if (name === 'options') {
    return <OptionsSurface />;
  }

  return null;
}
