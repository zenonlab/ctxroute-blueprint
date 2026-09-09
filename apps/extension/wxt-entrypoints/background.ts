import { applyConfirmedOrganizerPreview, hydrateAgendaFromPublicReleaseCache, parseOrganizerConfiguration, readAgendaPeriod, readLibraryPage, readOrganizerPreview, readPopupContext, readReviewQueue, restoreConfirmedOrganizerSnapshot, saveOrganizerConfiguration, scheduleAgendaPeriodNotifications } from '@tobirink/application';
import {
  anilistSourceAdapter,
  mangaUpdatesSourceAdapter,
  mangaDexSourceAdapter,
  WebExtensionBookmarkEventAdapter,
  WebExtensionBookmarkImportAdapter,
  WebExtensionOrganizerAdapter,
  WebExtensionPageContextAdapter,
  WebExtensionPopupContinuationCacheAdapter,
  WebExtensionNotificationAdapter,
  WebExtensionPublicReleaseCacheAdapter,
  WebExtensionQuickPreferencesAdapter,
  WebExtensionProviderIdentitySyncAdapter,
  WebExtensionProviderIdentitySyncStateAdapter,
  WebExtensionFavoriteOwnerStateAdapter,
  HttpFavoriteCollectiveAdapter,
} from '@tobirink/adapters-browser';
import { DexieFavoriteResolutionOutbox, DexieOrganizerSnapshotStore, DexieProviderRateCheckpointAdapter, DexieProviderIdentityRecoveryStateAdapter, DexieTaskStore } from '@tobirink/adapters-indexeddb';
import { libraryId, workId } from '@tobirink/domain';
import { readLocalReviewCandidateSnapshot, writeLocalReviewDecision } from '../runtime/local-review-runtime';
import { readLocalSearchSnapshot } from '../runtime/local-search-runtime';
import { readLocalLibraryCatalogueSnapshot } from '../runtime/local-library-catalogue-runtime';
import { drainDueAgendaNotifications, reminderAlarmName, reminderAlarmPeriodMinutes } from '../runtime/local-notification-runtime';
import { createExtensionLocalStorage } from '../runtime/local-storage';
import { extensionMessageSchema } from '../runtime/messages';
const configuredSiteOrigin = import.meta.env.WXT_PUBLIC_SITE_ORIGIN?.trim() || 'https://tobirink.com';
import { createWebBridgeRuntime } from '../runtime/web-bridge-runtime';
import { createWebBridgeRequestHandler } from '../runtime/web-bridge-adapter';
import { createFavoriteResolutionRuntime, subscribeFavoriteBookmarkMutations } from '../runtime/favorite-resolution-runtime';
import { createFavoriteProviderPorts } from '../runtime/favorite-provider-runtime';
import { bundledFavoriteSiteRules, createFavoriteSiteAdapters, ProviderIdentitySyncPublisher, providerSyncPrefix } from '@tobirink/application';
import { createProviderIdentityRecoveryRuntime } from '../runtime/provider-identity-recovery-runtime';
import { FavoriteOwnerRuntime } from '../runtime/favorite-owner-runtime';

const primaryLibraryId = libraryId('library_primary');

export default defineBackground({
  type: 'module',
  main() {
    const pageContext = new WebExtensionPageContextAdapter(browser.tabs);
    const cache = new WebExtensionPopupContinuationCacheAdapter(browser.storage.local);
    const releaseCache = new WebExtensionPublicReleaseCacheAdapter(browser.storage.local);
    const preferences = new WebExtensionQuickPreferencesAdapter(browser.storage.local);
    const tasks = new DexieTaskStore();
    const notifications = new WebExtensionNotificationAdapter(browser.notifications, browser.runtime.getURL('/icons/tobirink-128.png'));
    const bookmarks = new WebExtensionBookmarkImportAdapter(browser.bookmarks);
    const bookmarkEvents = new WebExtensionBookmarkEventAdapter(browser.bookmarks);
    const bookmarkOrganizer = new WebExtensionOrganizerAdapter(browser.bookmarks);
    const organizerSnapshots = new DexieOrganizerSnapshotStore();
    const privateStorage = createExtensionLocalStorage();
    const now = () => new Date().toISOString();
    const token = () => crypto.randomUUID();
    const resolutionOutbox = new DexieFavoriteResolutionOutbox(privateStorage.storage.database);
    const providerPorts = createFavoriteProviderPorts(new DexieProviderRateCheckpointAdapter(privateStorage.storage));
    const identityAccessPolicy = import.meta.env.FIREFOX ? 'firefox-background-only' : 'native-required';
    const ownerRuntime = configuredSiteOrigin ? new FavoriteOwnerRuntime(new WebExtensionFavoriteOwnerStateAdapter(browser.storage.local, identityAccessPolicy), new HttpFavoriteCollectiveAdapter(configuredSiteOrigin), privateStorage.storage) : undefined;
    const identitySync = new WebExtensionProviderIdentitySyncAdapter(browser.storage.sync, identityAccessPolicy);
    const identityRecovery = createProviderIdentityRecoveryRuntime({
      checkpoints: new DexieProviderIdentityRecoveryStateAdapter(privateStorage.storage.database),
      hydration: providerPorts,
      now,
      publisher: new ProviderIdentitySyncPublisher(identitySync, new WebExtensionProviderIdentitySyncStateAdapter(browser.storage.local, identityAccessPolicy), Date.now),
      storage: privateStorage.storage,
      sync: identitySync,
    });
    const webBridgeRequestHandler = createWebBridgeRequestHandler(privateStorage.storage, providerPorts);
    const webBridgeRuntime = createWebBridgeRuntime(webBridgeRequestHandler);
    const ensureReminderAlarm = () => browser.alarms.create(reminderAlarmName, { periodInMinutes: reminderAlarmPeriodMinutes });
    const reconcileFavorites = createFavoriteResolutionRuntime({
      beforeInventory: async () => { await ownerRuntime?.maintain().catch(() => undefined); },
      collective: ownerRuntime,
      bookmarks,
      candidates: providerPorts,
      ensureReady: privateStorage.ensureReady,
      hydration: providerPorts,
      libraryId: primaryLibraryId,
      identityRecovery,
      now,
      outbox: resolutionOutbox,
      get sourceAdapters() { return [anilistSourceAdapter, mangaUpdatesSourceAdapter, mangaDexSourceAdapter, ...createFavoriteSiteAdapters(ownerRuntime?.rules ?? bundledFavoriteSiteRules)]; },
      storage: privateStorage.storage,
      token,
    });
    browser.runtime.onInstalled.addListener(async () => {
      await ensureReminderAlarm();
      await privateStorage.ensureReady();
      await reconcileFavorites();
      await resumeNotifications();
    });
    subscribeFavoriteBookmarkMutations(bookmarkEvents, { ensureReady: privateStorage.ensureReady, now, storage: privateStorage.storage, token }, () => reconcileFavorites(true));
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && Object.keys(changes).some((key) => key.startsWith(providerSyncPrefix) && key.endsWith('.manifest'))) {
        void reconcileFavorites(true).catch(() => undefined);
      }
    });
    const resumeNotifications = async () => {
      await privateStorage.ensureReady();
      const hydration = await hydrateAgendaFromPublicReleaseCache(privateStorage.storage, releaseCache);
      if ((await preferences.read()).nativeNotifications) {
        await scheduleAgendaPeriodNotifications(privateStorage.storage, tasks, hydration.entries);
      }
      await drainDueAgendaNotifications({ notifications, preferences, storage: privateStorage.storage, tasks }, new Date());
    };
    browser.runtime.onStartup.addListener(() => {
      void ensureReminderAlarm().then(() => Promise.all([resumeNotifications(), reconcileFavorites()])).catch(() => undefined);
    });
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === reminderAlarmName) void Promise.all([resumeNotifications(), reconcileFavorites()]).catch(() => undefined);
    });
    browser.runtime.onMessage.addListener(async (value, sender) => {
      if (sender.id && sender.id !== browser.runtime.id) return { error: 'invalid-sender', ok: false };
      const parsed = extensionMessageSchema.safeParse(value);
      if (!parsed.success) return { error: 'invalid-message', ok: false };
      if (parsed.data.type === 'owner.action') {
        if (sender.id !== browser.runtime.id || sender.url?.split(/[?#]/u, 1)[0] !== browser.runtime.getURL('/options.html')) return { error: 'trusted-options-required', ok: false };
        if (ownerRuntime === undefined) return { ok: true, status: 'unavailable' };
        try {
          const action = parsed.data.action;
          if (action.kind === 'enable') await ownerRuntime.enable();
          if (action.kind === 'revoke') await ownerRuntime.revoke();
          if (action.kind === 'redeem') await ownerRuntime.redeem(action.invitation);
          if (action.kind === 'pair') return { ok: true, status: await ownerRuntime.status(), invitation: await ownerRuntime.pair() };
          return { ok: true, status: await ownerRuntime.status() };
        } catch { return { ok: false, error: 'owner-operation-unavailable' }; }
      }
      if (parsed.data.type === 'webbridge.handshake') {
        return webBridgeRuntime(parsed.data, sender, configuredSiteOrigin);
      }
      if (parsed.data.type === 'webbridge.request') {
        return webBridgeRuntime(parsed.data, sender, configuredSiteOrigin);
      }
      if (parsed.data.type === 'health.check') return { ok: true, version: 1 };
      if (parsed.data.type === 'favorite.status.read') {
        try {
          await privateStorage.ensureReady();
          return { ok: true, counts: await privateStorage.storage.readFavoriteResolutionCounts() };
        } catch { return { ok: false, error: 'favorite-status-unavailable' }; }
      }
      if (parsed.data.type === 'review.queue.read') {
        try {
          await privateStorage.ensureReady();
          return { ok: true, snapshot: await readReviewQueue(privateStorage.storage) };
        } catch {
          return { error: 'review-queue-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'review.candidates.read') {
        try {
          await privateStorage.ensureReady();
          return { ok: true, snapshot: await readLocalReviewCandidateSnapshot(privateStorage.storage, primaryLibraryId, parsed.data.reviewId) };
        } catch {
          return { error: 'review-candidates-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'review.decision.write') {
        try {
          await privateStorage.ensureReady();
          const review = await writeLocalReviewDecision(privateStorage.storage, primaryLibraryId, parsed.data, providerPorts);
          return { ok: true, status: review.status };
        } catch (error) {
          return { error: error instanceof Error && /conflict|stale/u.test(error.message) ? 'conflict' : 'unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'library.page.read') {
        try {
          await privateStorage.ensureReady();
          const input = parsed.data.afterId
            ? { afterId: workId(parsed.data.afterId), libraryId: primaryLibraryId }
            : { libraryId: primaryLibraryId };
          const snapshot = await readLibraryPage(privateStorage.storage, input);
          return {
            ok: true,
            snapshot: {
              items: snapshot.items.map((work) => ({
                id: work.id,
                mediaType: work.mediaKind,
                source: work.externalReferences[0]?.provider ?? work.mediaKind,
                title: work.preferredTitle,
              })),
              missingWorkIds: snapshot.missingWorkIds,
              nextCursor: snapshot.nextCursor,
            },
          };
        } catch {
          return { error: 'library-page-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'library.catalogue.read') {
        try {
          await privateStorage.ensureReady();
          return { ok: true, snapshot: await readLocalLibraryCatalogueSnapshot(privateStorage.storage, primaryLibraryId, parsed.data) };
        } catch {
          return { error: 'library-catalogue-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'library.search.read') {
        try {
          await privateStorage.ensureReady();
          return { ok: true, snapshot: await readLocalSearchSnapshot(privateStorage.storage, primaryLibraryId, parsed.data.query) };
        } catch {
          return { error: 'library-search-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'search.open') {
        try {
          await privateStorage.ensureReady();
          await readLocalSearchSnapshot(privateStorage.storage, primaryLibraryId, parsed.data.query);
          const target = new URL(browser.runtime.getURL('/library.html'));
          target.searchParams.set('query', parsed.data.query.trim());
          await browser.tabs.create({ url: target.toString() });
          return { ok: true };
        } catch {
          return { error: 'library-search-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'agenda.period.read') {
        try {
          await privateStorage.ensureReady();
          const hydration = await hydrateAgendaFromPublicReleaseCache(privateStorage.storage, releaseCache);
          const quickPreferences = await preferences.read();
          const snapshot = await readAgendaPeriod(privateStorage.storage, parsed.data);
          if (quickPreferences.nativeNotifications) {
            await scheduleAgendaPeriodNotifications(privateStorage.storage, tasks, snapshot.items.map(({ entry }) => entry));
          }
          return {
            ok: true,
            snapshot: {
              items: snapshot.items.filter(({ entry }) => quickPreferences.showEstimatedReleases || entry.availability !== 'estimated').map(({ entry, source, work }) => {
                const item = {
                  availability: entry.availability,
                  id: entry.id,
                  mediaType: work.mediaKind,
                  occursAt: entry.occursAt,
                  release: entry.releaseLabel,
                  source: work.externalReferences[0]?.provider ?? work.mediaKind,
                  title: work.preferredTitle,
                  workId: work.id,
                };
                return source ? { ...item, sourceUrl: source.url } : item;
              }),
              missingWorkIds: [...snapshot.missingWorkIds, ...hydration.missingWorkIds],
              source: hydration.state === 'hydrated' ? 'cache' : 'local',
              updatedAt: hydration.generatedAt ?? new Date().toISOString(),
            },
          };
        } catch {
          return { error: 'agenda-period-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'preferences.quick.read') {
        try {
          return { ok: true, preferences: await preferences.read() };
        } catch {
          return { error: 'quick-preferences-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'preferences.quick.write') {
        try {
          await preferences.write(parsed.data.preferences);
          if (parsed.data.preferences.nativeNotifications) await resumeNotifications();
          return { ok: true, preferences: await preferences.read() };
        } catch {
          return { error: 'quick-preferences-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'organizer.configuration.read') {
        try {
          await privateStorage.ensureReady();
          return { canRestore: (await organizerSnapshots.load()) !== undefined, configuration: await privateStorage.storage.getOrganizerConfiguration(), ok: true };
        } catch {
          return { error: 'organizer-configuration-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'organizer.configuration.write') {
        try {
          await privateStorage.ensureReady();
          const configuration = await saveOrganizerConfiguration(privateStorage.storage, parseOrganizerConfiguration(parsed.data.configuration));
          return { canRestore: (await organizerSnapshots.load()) !== undefined, configuration, ok: true };
        } catch {
          return { error: 'organizer-configuration-invalid', ok: false };
        }
      }
      if (parsed.data.type === 'organizer.preview.read') {
        try {
          await privateStorage.ensureReady();
          const snapshot = await readOrganizerPreview(privateStorage.storage, parseOrganizerConfiguration(parsed.data.configuration));
          return { ok: true, snapshot };
        } catch {
          return { error: 'organizer-preview-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'organizer.preview.apply') {
        try {
          await privateStorage.ensureReady();
          const result = await applyConfirmedOrganizerPreview(
            { bookmarks: bookmarkOrganizer, snapshots: organizerSnapshots, storage: privateStorage.storage },
            { configuration: parseOrganizerConfiguration(parsed.data.configuration), confirmation: parsed.data.confirmation, expected: parsed.data.expected, now: new Date().toISOString() },
          );
          await reconcileFavorites();
          return { ...result, ok: true };
        } catch {
          return { error: 'organizer-preview-stale-or-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'organizer.snapshot.restore') {
        try {
          const result = await restoreConfirmedOrganizerSnapshot({ bookmarks: bookmarkOrganizer, snapshots: organizerSnapshots }, parsed.data.confirmation);
          await privateStorage.ensureReady();
          await reconcileFavorites();
          return { ...result, ok: true };
        } catch {
          return { error: 'organizer-snapshot-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'popup.context.read') {
        try {
          await privateStorage.ensureReady();
          const snapshot = await readPopupContext({ cache, now: () => new Date().toISOString(), pageContext, storage: privateStorage.storage });
          return { ok: true, snapshot };
        } catch {
          return { error: 'popup-context-unavailable', ok: false };
        }
      }

      if (parsed.data.target === 'settings') {
        await browser.runtime.openOptionsPage();
      } else {
        await browser.tabs.create({ url: browser.runtime.getURL(`/${parsed.data.target}.html`) });
      }
      return { ok: true };
    });
  },
});
