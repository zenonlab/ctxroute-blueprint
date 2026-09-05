import { useCallback, useEffect, useState } from 'react';
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
import { readPopupContextMessage, sendExtensionMessage } from './messages';
import { useLocalReviewNavigation } from './use-local-review-navigation';

export type ExtensionSurfaceName = 'agenda' | 'library' | 'options' | 'popup' | 'review';

const emptyFilterOptions = { progress: [], status: [], type: [] } as const;

function open(target: NavigationTarget) {
  void sendExtensionMessage({ target, type: 'navigation.open', version: 1 });
}

function LibrarySurface() {
  const [filters, setFilters] = useState<LibraryFiltersValue>(emptyLibraryFilters);
  const navigation = useLocalReviewNavigation('library');

  return (
    <Library
      filterOptions={emptyFilterOptions}
      filters={filters}
      items={[]}
      navigation={navigation}
      onChangeFilters={setFilters}
      onDownloadExtension={() => undefined}
      onLoadMore={() => undefined}
      onOpenRecovery={() => open('settings')}
      onRetry={() => undefined}
      state="empty"
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
  return <Agenda canNext={false} canPrevious={false} days={[]} navigation={navigation} onNext={() => undefined} onPrevious={() => undefined} onRetry={() => undefined} periodLabel="Cette semaine" state="empty" updatedAt="Jamais" />;
}

function OptionsSurface() {
  return (
    <Settings
      onRetry={() => undefined}
      state="blocked"
    />
  );
}

function PopupSurface() {
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

  return (
    <Popup
      agenda={{ state: 'blocked' }}
      connection={model.page.state === 'loading'
        ? { label: 'Lecture du contexte local', tone: 'syncing' }
        : model.page.state === 'error'
          ? { label: 'Lecture locale interrompue', tone: 'error' }
          : { label: 'Données locales prêtes', tone: 'ready' }}
      continuations={model.continuations}
      onOpenFullSettings={() => open('settings')}
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
