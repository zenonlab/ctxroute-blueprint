import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { emptyLibraryFilters } from '@tobirink/ui';
import type { LibraryFiltersValue } from '@tobirink/ui';
import { Agenda } from '../entrypoints/agenda';
import { Library } from '../entrypoints/library';
import { Settings } from '../entrypoints/options';
import { Popup } from '../entrypoints/popup';
import type { PopupWork } from '../entrypoints/popup';
import { Review } from '../entrypoints/review';
import type { NavigationTarget } from './messages';
import { readLibraryCatalogueMessage, readPopupContextMessage, sendExtensionMessage } from './messages';
import type { LibraryCatalogueResponse } from './messages';
import { useLocalAgenda } from './use-local-agenda';
import { useLocalOrganizerSettings } from './use-local-organizer-settings';
import { useLocalReviewNavigation } from './use-local-review-navigation';
import { useQuickPreferences } from './use-quick-preferences';
import { CollectiveSettings } from '../entrypoints/options/CollectiveSettings';
import { useFavoriteOwner } from './use-favorite-owner';
import { ResolutionStatus } from '../entrypoints/options/ResolutionStatus';
import { useResolutionStatus } from './use-resolution-status';

export type ExtensionSurfaceName = 'agenda' | 'library' | 'options' | 'popup' | 'review';

function open(target: NavigationTarget) {
  void sendExtensionMessage({ target, type: 'navigation.open', version: 1 });
}

interface LibrarySurfaceContentProps {
  navigation: ComponentProps<typeof Library>['navigation'];
  readCatalogue?: typeof readLibraryCatalogueMessage;
  renderLibrary?: (props: ComponentProps<typeof Library>) => ReactNode;
}

export function LibrarySurfaceContent({ navigation, readCatalogue = readLibraryCatalogueMessage, renderLibrary }: LibrarySurfaceContentProps) {
  const initialQuery = typeof window === 'undefined' ? '' : new URL(window.location.href).searchParams.get('query')?.trim() ?? '';
  const [filters, setFilters] = useState<LibraryFiltersValue>({ ...emptyLibraryFilters, query: initialQuery });
  const [loadKey, setLoadKey] = useState(0);
  const [model, setModel] = useState<{
    facets: Extract<LibraryCatalogueResponse, { ok: true }>['snapshot']['facets'];
    items: Extract<LibraryCatalogueResponse, { ok: true }>['snapshot']['items'];
    loadingMore: boolean;
    nextOffset?: number;
    state: 'empty' | 'error' | 'loading' | 'partial' | 'ready';
    statistics?: Extract<LibraryCatalogueResponse, { ok: true }>['snapshot']['statistics'];
  }>({ facets: { format: [], genre: [], progress: [], source: [], status: [], type: [], year: [] }, items: [], loadingMore: false, state: 'loading' });
  const catalogueInput = useMemo(() => ({
    facets: { format: filters.format, genre: filters.genre, progress: filters.progress, source: filters.source, status: filters.status, type: filters.type, year: filters.year },
    query: filters.query,
    sort: filters.sort,
  }), [filters]);
  const catalogueInputRef = useRef(catalogueInput);
  const requestGeneration = useRef(0);
  catalogueInputRef.current = catalogueInput;

  useEffect(() => {
    let active = true;
    const generation = ++requestGeneration.current;
    setModel((current) => current.statistics === undefined
      ? { ...current, items: [], loadingMore: false, state: 'loading' }
      : current);
    void readCatalogue(catalogueInput).then((snapshot) => {
      if (!active || requestGeneration.current !== generation) return;
      setModel({
        facets: snapshot.facets,
        items: snapshot.items,
        loadingMore: false,
        nextOffset: snapshot.nextOffset,
        state: snapshot.truncated ? 'partial' : snapshot.statistics.total > 0 ? 'ready' : 'empty',
        statistics: snapshot.statistics,
      });
    }).catch(() => {
      if (active && requestGeneration.current === generation) setModel((current) => ({ ...current, items: [], loadingMore: false, state: 'error' }));
    });
    return () => { active = false; };
  }, [catalogueInput, loadKey, readCatalogue]);

  const loadMore = useCallback(() => {
    if (model.nextOffset === undefined || model.loadingMore) return;
    const generation = requestGeneration.current;
    const requestedInput = catalogueInput;
    setModel((current) => ({ ...current, loadingMore: true }));
    void readCatalogue({ ...catalogueInput, offset: model.nextOffset }).then((snapshot) => {
      if (requestGeneration.current !== generation || catalogueInputRef.current !== requestedInput) return;
      setModel((current) => ({
        facets: snapshot.facets,
        items: [...current.items, ...snapshot.items],
        loadingMore: false,
        nextOffset: snapshot.nextOffset,
        state: snapshot.truncated ? 'partial' : 'ready',
        statistics: snapshot.statistics,
      }));
    }).catch(() => {
      if (requestGeneration.current === generation && catalogueInputRef.current === requestedInput) {
        setModel((current) => ({ ...current, loadingMore: false }));
      }
    });
  }, [catalogueInput, model.loadingMore, model.nextOffset, readCatalogue]);

  const props: ComponentProps<typeof Library> = {
    filterOptions: model.facets,
    filters,
    hasMore: model.nextOffset !== undefined,
    items: model.items,
    navigation,
    onChangeFilters: setFilters,
    onLoadMore: loadMore,
    onOpenRecovery: () => open('settings'),
    onRetry: () => {
      requestGeneration.current += 1;
      setLoadKey((key) => key + 1);
    },
    state: model.state,
  };
  if (model.statistics !== undefined) props.statistics = model.statistics;
  return renderLibrary ? renderLibrary(props) : <Library {...props} />;
}

function LibrarySurface() {
  const navigation = useLocalReviewNavigation('library');
  return <LibrarySurfaceContent navigation={navigation} />;
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
  const owner = useFavoriteOwner();
  const resolution = useResolutionStatus();
  return <><Settings {...settings} /><ResolutionStatus {...resolution} /><CollectiveSettings {...owner} /></>;
}

function PopupSurface() {
  const localAgenda = useLocalAgenda();
  const quickPreferences = useQuickPreferences();
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
      onPreferenceChange={quickPreferences.onChange}
      onRetryAgenda={localAgenda.onRetry}
      onRetryPage={retry}
      page={model.page}
      preferences={quickPreferences.model}
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
