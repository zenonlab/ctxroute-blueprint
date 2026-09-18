import { applyConfirmedOrganizerPreview, createEncryptedBackup, parseOrganizerConfiguration, readLibraryPage, readLocalReleaseAgenda, readOrganizerPreview, readPopupContext, readReviewQueue, restoreConfirmedOrganizerSnapshot, restoreEncryptedBackup, saveOrganizerConfiguration, scheduleAgendaPeriodNotifications } from '@tobirink/application';
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
  WebExtensionQuickPreferencesAdapter,
  HttpPublicDiscoveryAdapter,
  HttpPublicReleaseLoader,
} from '@tobirink/adapters-browser';
import { DexieFavoriteResolutionOutbox, DexieLocalReleaseAgenda, DexieOrganizerSnapshotStore, DexiePrivateRecoveryStore, DexiePublicReleaseGenerationCache, DexieTaskStore } from '@tobirink/adapters-indexeddb';
import { isContentVisible, libraryId, workId } from '@tobirink/domain';
import { repairFavoriteLibraryProjection } from '../runtime/repair-library-projection';
import { readLocalReviewCandidateSnapshot, writeLocalReviewDecision } from '../runtime/local-review-runtime';
import { readLocalSearchSnapshot } from '../runtime/local-search-runtime';
import { readLocalLibraryCatalogueSnapshot } from '../runtime/local-library-catalogue-runtime';
import { agendaNextAlarmName, agendaReconcileAlarmName, agendaReconcileAlarmPeriodMinutes, drainDueAgendaNotifications, reminderAlarmName, reminderAlarmPeriodMinutes } from '../runtime/local-notification-runtime';
import { createExtensionLocalStorage } from '../runtime/local-storage';
import { extensionMessageSchema } from '../runtime/messages';
const configuredSiteOrigin = import.meta.env.WXT_PUBLIC_SITE_ORIGIN?.trim() || 'https://tobirink.com';
import { createWebBridgeRuntime } from '../runtime/web-bridge-runtime';
import { createWebBridgeRequestHandler } from '../runtime/web-bridge-adapter';
import { createFavoriteResolutionRuntime, favoriteInventoryAuditAlarmName, favoriteInventoryAuditPeriodMinutes, subscribeFavoriteBookmarkMutations } from '../runtime/favorite-resolution-runtime';
import { bundledFavoriteSiteRules, createFavoriteSiteAdapters, projectLocalReleaseAgenda } from '@tobirink/application';
import { WebExtensionDiagnostics } from '../runtime/extension-diagnostics';
import { favoriteResolutionContinuationAlarmName, favoriteResolutionContinuationMinimumDelayMs, readFavoriteResolutionPaused, restoreFavoriteResolutionContinuation, updateFavoriteResolutionContinuation, writeFavoriteResolutionPaused } from '../runtime/favorite-resolution-continuation';
import { createPublicDiscoveryRefreshRuntime } from '../runtime/public-discovery-refresh-runtime';

const primaryLibraryId = libraryId('library_primary');
const providerNetworkDisabled = Object.freeze({
  hydrate: async () => { throw new Error('Provider network is disabled in the extension.'); },
  search: async () => { throw new Error('Provider network is disabled in the extension.'); },
});
const disabledProviderPorts = Object.freeze({
  anilist: providerNetworkDisabled,
  'kitsu-anime': providerNetworkDisabled,
  'kitsu-manga': providerNetworkDisabled,
  mangadex: providerNetworkDisabled,
  mangaupdates: providerNetworkDisabled,
});
interface FavoriteStatusInventory {
  continuationAt?: string;
  startedAt?: string;
  status: 'not-started' | 'inventory' | 'presence' | 'complete';
}

export default defineBackground({
  type: 'module',
  main() {
    const pageContext = new WebExtensionPageContextAdapter(browser.tabs);
    const cache = new WebExtensionPopupContinuationCacheAdapter(browser.storage.local);
    const preferences = new WebExtensionQuickPreferencesAdapter(browser.storage.local);
    const readShowAdultContent = async () => (await preferences.read()).showAdultContent;
    const tasks = new DexieTaskStore();
    const notifications = new WebExtensionNotificationAdapter(browser.notifications, browser.runtime.getURL('/icons/tobirink-128.png'));
    const bookmarks = new WebExtensionBookmarkImportAdapter(browser.bookmarks);
    const bookmarkEvents = new WebExtensionBookmarkEventAdapter(browser.bookmarks);
    const bookmarkOrganizer = new WebExtensionOrganizerAdapter(browser.bookmarks);
    const organizerSnapshots = new DexieOrganizerSnapshotStore();
    const privateStorage = createExtensionLocalStorage();
    const repairLibraryProjection = () => repairFavoriteLibraryProjection(privateStorage.storage, primaryLibraryId);
    const now = () => new Date().toISOString();
    const token = () => crypto.randomUUID();
    const diagnostics = new WebExtensionDiagnostics(browser.storage.local, now, token);
    const releaseCache = new DexiePublicReleaseGenerationCache(privateStorage.storage.database);
    const releaseAgenda = new DexieLocalReleaseAgenda(privateStorage.storage.database);
    const releaseWindow = () => {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - 1);
      const end = new Date();
      end.setUTCDate(end.getUTCDate() + 15);
      return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
    };
    const refreshPublicReleasesOnce = async () => {
      await new HttpPublicReleaseLoader(configuredSiteOrigin).load(releaseCache, releaseWindow());
      return 'shared' as const;
    };
    let releaseRefreshInFlight: ReturnType<typeof refreshPublicReleasesOnce> | undefined;
    const refreshPublicReleases = () => {
      releaseRefreshInFlight ??= refreshPublicReleasesOnce().finally(() => { releaseRefreshInFlight = undefined; });
      return releaseRefreshInFlight;
    };
    const resolutionOutbox = new DexieFavoriteResolutionOutbox(privateStorage.storage.database);
    const resolutionPaused = () => readFavoriteResolutionPaused(browser.storage.local);
    const privateRecovery = new DexiePrivateRecoveryStore(privateStorage.storage.database);
    const publicDiscovery = new HttpPublicDiscoveryAdapter(configuredSiteOrigin, undefined, browser.storage.local);
    const refreshPublicDiscovery = createPublicDiscoveryRefreshRuntime({ checkpointStorage: browser.storage.local, client: publicDiscovery, now, storage: privateStorage.storage });
    const webBridgeRequestHandler = createWebBridgeRequestHandler(privateStorage.storage, publicDiscovery, releaseAgenda, readShowAdultContent);
    const webBridgeRuntime = createWebBridgeRuntime(webBridgeRequestHandler);
    const ensureReminderAlarm = () => browser.alarms.create(reminderAlarmName, { periodInMinutes: reminderAlarmPeriodMinutes });
    const ensureAgendaReconcileAlarm = () => browser.alarms.create(agendaReconcileAlarmName, { periodInMinutes: agendaReconcileAlarmPeriodMinutes });
    const ensureAgendaNextAlarm = () => browser.alarms.create(agendaNextAlarmName, { delayInMinutes: 1 });
    const ensureFavoriteInventoryAuditAlarm = () => browser.alarms.create(favoriteInventoryAuditAlarmName, { periodInMinutes: favoriteInventoryAuditPeriodMinutes });
    const runFavoriteResolution = createFavoriteResolutionRuntime({
      beforeInventory: async () => undefined,
      publicDiscovery,
      bookmarks,
      candidates: disabledProviderPorts,
      ensureReady: privateStorage.ensureReady,
      diagnostics,
      hydration: disabledProviderPorts,
      libraryId: primaryLibraryId,
      now,
      outbox: resolutionOutbox,
      refreshPublicDiscovery,
      updateContinuation: async (availableAt) => {
        if (await resolutionPaused()) await browser.alarms.clear(favoriteResolutionContinuationAlarmName);
        else await updateFavoriteResolutionContinuation(browser.alarms, availableAt);
      },
      get sourceAdapters() { return [anilistSourceAdapter, mangaUpdatesSourceAdapter, mangaDexSourceAdapter, ...createFavoriteSiteAdapters(bundledFavoriteSiteRules)]; },
      storage: privateStorage.storage,
      token,
    });
    const reconcileFavorites = async (inventoryRequested = false) => {
      if (await resolutionPaused()) {
        await browser.alarms.clear(favoriteResolutionContinuationAlarmName);
        return;
      }
      await runFavoriteResolution(inventoryRequested);
    };
    browser.runtime.onInstalled.addListener(() => {
      void (async () => {
        await ensureReminderAlarm();
        await ensureFavoriteInventoryAuditAlarm();
        await diagnostics.initializeEnabled().catch(() => undefined);
        await privateStorage.ensureReady();
        await reconcileFavorites(true);
        await repairLibraryProjection();
        await resumeNotifications();
      })().catch(() => undefined);
    });
    const restoreFavoriteWake = async () => {
      if (await resolutionPaused()) {
        await browser.alarms.clear(favoriteResolutionContinuationAlarmName);
        return;
      }
      await privateStorage.ensureReady();
      const [checkpoint, existing] = await Promise.all([
        privateStorage.storage.getFavoriteInventoryCheckpoint(),
        browser.alarms.get(favoriteResolutionContinuationAlarmName),
      ]);
      const immediateDeadline = Date.now() + favoriteResolutionContinuationMinimumDelayMs;
      if (checkpoint === undefined) {
        await reconcileFavorites(true);
        await repairLibraryProjection();
        return;
      }
      if (existing?.scheduledTime !== undefined && existing.scheduledTime > Date.now()
        && (checkpoint?.status !== 'active' || existing.scheduledTime <= immediateDeadline)) return;
      await restoreFavoriteResolutionContinuation(browser.alarms, privateStorage.storage, resolutionOutbox);
    };
    const readFavoriteStatus = async () => {
      await restoreFavoriteWake();
      const [counts, checkpoint, continuation, paused] = await Promise.all([
        privateStorage.storage.readFavoriteResolutionCounts(),
        privateStorage.storage.getFavoriteInventoryCheckpoint(),
        browser.alarms.get(favoriteResolutionContinuationAlarmName),
        resolutionPaused(),
      ]);
      const status = checkpoint === undefined
        ? 'not-started' as const
        : checkpoint.status === 'complete'
          ? 'complete' as const
          : checkpoint.phase === 'presence'
            ? 'presence' as const
            : 'inventory' as const;
      const inventory: FavoriteStatusInventory = { status };
      if (continuation?.scheduledTime !== undefined) inventory.continuationAt = new Date(continuation.scheduledTime).toISOString();
      if (checkpoint?.startedAt !== undefined) inventory.startedAt = checkpoint.startedAt;
      const controllerState = paused ? 'paused' as const
        : status === 'inventory' ? 'inventory' as const
          : status === 'presence' ? 'presence' as const
            : counts.processing > 0 ? 'resolving' as const
              : counts.retryable > 0 ? 'waiting-provider' as const
                : counts.blocked > 0 ? 'blocked' as const
                  : status === 'not-started' ? 'idle' as const : 'complete' as const;
      return { controller: { paused, state: controllerState }, counts, diagnostics: await diagnostics.read().catch(() => ({ enabled: false, events: [] })), inventory, ok: true as const };
    };
    subscribeFavoriteBookmarkMutations(bookmarkEvents, {
      bookmarks, ensureReady: privateStorage.ensureReady, now,
      get sourceAdapters() { return [anilistSourceAdapter, mangaUpdatesSourceAdapter, mangaDexSourceAdapter, ...createFavoriteSiteAdapters(bundledFavoriteSiteRules)]; },
      storage: privateStorage.storage, token,
    }, reconcileFavorites);
    const resumeNotifications = async () => {
      await privateStorage.ensureReady();
      await refreshPublicReleases();
      const hydration = await projectLocalReleaseAgenda(privateStorage.storage, releaseCache, releaseAgenda);
      const quickPreferences = await preferences.read();
      if (quickPreferences.nativeNotifications) {
        const visibleWorkIds = new Set((await readLocalReleaseAgenda(privateStorage.storage, releaseAgenda, releaseWindow())).items
          .filter(({ work }) => isContentVisible(work.hydration?.candidate, quickPreferences.showAdultContent))
          .map(({ work }) => work.id));
        await scheduleAgendaPeriodNotifications(privateStorage.storage, tasks, hydration.entries.filter((entry) => visibleWorkIds.has(entry.workId)));
      }
      await drainDueAgendaNotifications({ notifications, preferences, storage: privateStorage.storage, tasks }, new Date());
    };
    browser.runtime.onStartup.addListener(() => {
      void Promise.all([ensureReminderAlarm(), ensureFavoriteInventoryAuditAlarm()]).then(() => Promise.all([resumeNotifications(), reconcileFavorites()])).catch(() => undefined);
    });
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === reminderAlarmName || alarm.name === agendaNextAlarmName || alarm.name === agendaReconcileAlarmName) void Promise.all([resumeNotifications(), restoreFavoriteWake()]).catch(() => undefined);
      if (alarm.name === favoriteResolutionContinuationAlarmName) void reconcileFavorites().then(repairLibraryProjection).catch(() => undefined);
      if (alarm.name === favoriteInventoryAuditAlarmName) void reconcileFavorites(true).then(repairLibraryProjection).catch(() => undefined);
    });
    browser.runtime.onMessage.addListener(async (value, sender) => {
      if (sender.id && sender.id !== browser.runtime.id) return { error: 'invalid-sender', ok: false };
      const parsed = extensionMessageSchema.safeParse(value);
      if (!parsed.success) return { error: 'invalid-message', ok: false };
      if (parsed.data.type === 'recovery.backup.export' || parsed.data.type === 'recovery.backup.restore') {
        if (sender.id !== browser.runtime.id || sender.url?.split(/[?#]/u, 1)[0] !== browser.runtime.getURL('/options.html')) return { error: 'trusted-options-required', ok: false };
        try {
          await privateStorage.ensureReady();
          if (parsed.data.type === 'recovery.backup.export') {
            const exportedAt = now();
            const blob = await createEncryptedBackup(privateRecovery, exportedAt, parsed.data.passphrase);
            return { filename: `tobirink-private-${exportedAt.slice(0, 10)}.tobirink`, ok: true, serialized: blob.serialized, status: 'exported' };
          }
          await restoreEncryptedBackup({ format: 'tobirink-encrypted-backup-blob', serialized: parsed.data.serialized }, parsed.data.passphrase, privateRecovery, parsed.data.confirmation);
          try {
            await reconcileFavorites(true);
            await repairLibraryProjection();
          } catch {
            await updateFavoriteResolutionContinuation(browser.alarms, new Date(Date.now() + favoriteResolutionContinuationMinimumDelayMs).toISOString());
          }
          return { ok: true, status: 'restored' };
        } catch { return { error: 'private-recovery-unavailable', ok: false }; }
      }
      if (parsed.data.type === 'webbridge.handshake') {
        return webBridgeRuntime(parsed.data, sender, configuredSiteOrigin);
      }
      if (parsed.data.type === 'webbridge.request') {
        return webBridgeRuntime(parsed.data, sender, configuredSiteOrigin);
      }
      if (parsed.data.type === 'health.check') return { ok: true, version: 1 };
      if (parsed.data.type === 'favorite.status.read' || parsed.data.type === 'favorite.reconcile' || parsed.data.type === 'favorite.control.write' || parsed.data.type === 'favorite.diagnostics.write') {
        if (sender.id !== browser.runtime.id || sender.url?.split(/[?#]/u, 1)[0] !== browser.runtime.getURL('/options.html')) return { error: 'trusted-options-required', ok: false };
        try {
          await privateStorage.ensureReady();
          if (parsed.data.type === 'favorite.reconcile') {
            const checkpoint = await privateStorage.storage.getFavoriteInventoryCheckpoint();
            await reconcileFavorites(checkpoint?.status !== 'active');
            await repairLibraryProjection();
          }
          if (parsed.data.type === 'favorite.control.write') {
            if (parsed.data.action === 'pause') {
              await writeFavoriteResolutionPaused(browser.storage.local, true);
              await browser.alarms.clear(favoriteResolutionContinuationAlarmName);
            } else if (parsed.data.action === 'resume') {
              await writeFavoriteResolutionPaused(browser.storage.local, false);
              await reconcileFavorites();
              await repairLibraryProjection();
            } else {
              if (await resolutionPaused()) throw new Error('FAVORITE_RESOLUTION_PAUSED');
              await resolutionOutbox.retryBlocked({ availableAt: now(), kind: 'favorite-resolution', lane: 'routing', limit: 100 });
              await reconcileFavorites();
              await repairLibraryProjection();
            }
          }
          if (parsed.data.type === 'favorite.diagnostics.write') await diagnostics.setEnabled(parsed.data.enabled);
          return await readFavoriteStatus();
        } catch { return { ok: false, error: 'favorite-status-unavailable' }; }
      }
      if (parsed.data.type === 'review.queue.read') {
        try {
          await privateStorage.ensureReady();
          return { ok: true, snapshot: await readReviewQueue(privateStorage.storage, await readShowAdultContent()) };
        } catch {
          return { error: 'review-queue-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'review.candidates.read') {
        try {
          await privateStorage.ensureReady();
          return { ok: true, snapshot: await readLocalReviewCandidateSnapshot(privateStorage.storage, primaryLibraryId, parsed.data.reviewId, await readShowAdultContent()) };
        } catch {
          return { error: 'review-candidates-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'review.decision.write') {
        try {
          await privateStorage.ensureReady();
          const review = await writeLocalReviewDecision(privateStorage.storage, primaryLibraryId, parsed.data, publicDiscovery, await readShowAdultContent());
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
          const snapshot = await readLibraryPage(privateStorage.storage, { ...input, showAdultContent: await readShowAdultContent() });
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
          return { ok: true, snapshot: await readLocalLibraryCatalogueSnapshot(privateStorage.storage, primaryLibraryId, parsed.data, await readShowAdultContent()) };
        } catch {
          return { error: 'library-catalogue-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'library.search.read') {
        try {
          await privateStorage.ensureReady();
          return { ok: true, snapshot: await readLocalSearchSnapshot(privateStorage.storage, primaryLibraryId, parsed.data.query, await readShowAdultContent()) };
        } catch {
          return { error: 'library-search-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'search.open') {
        try {
          await privateStorage.ensureReady();
          await readLocalSearchSnapshot(privateStorage.storage, primaryLibraryId, parsed.data.query, await readShowAdultContent());
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
          await refreshPublicReleases();
          const hydration = await projectLocalReleaseAgenda(privateStorage.storage, releaseCache, releaseAgenda);
          const quickPreferences = await preferences.read();
          const snapshot = await readLocalReleaseAgenda(privateStorage.storage, releaseAgenda, parsed.data);
          const visibleItems = snapshot.items.filter(({ work }) => isContentVisible(work.hydration?.candidate, quickPreferences.showAdultContent));
          const visibleWorkIds = new Set(visibleItems.map(({ work }) => work.id));
          if (quickPreferences.nativeNotifications) {
            await scheduleAgendaPeriodNotifications(privateStorage.storage, tasks, hydration.entries.filter((entry) => visibleWorkIds.has(entry.workId)));
          }
          return {
            ok: true,
            snapshot: {
              items: visibleItems.filter(({ event }) => quickPreferences.showEstimatedReleases || event.availability !== 'estimated').map(({ event, source, work }) => {
                const item = {
                  availability: event.availability,
                  id: event.id,
                  mediaType: work.mediaKind,
                  release: event.releaseLabel,
                  source: work.externalReferences[0]?.provider ?? work.mediaKind,
                  title: work.preferredTitle,
                  workId: work.id,
                };
                const dated = event.occurrence.kind === 'DATE' ? { ...item, occursOn: event.occurrence.value } : { ...item, occursAt: event.occurrence.value };
                return source ? { ...dated, sourceUrl: source.url } : dated;
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
          const snapshot = await readPopupContext({ cache, now: () => new Date().toISOString(), pageContext, showAdultContent: false, storage: privateStorage.storage });
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
    void Promise.all([ensureReminderAlarm(), restoreFavoriteWake()]).then(() => Promise.all([ensureAgendaReconcileAlarm(), ensureAgendaNextAlarm()])).catch(() => undefined);
  },
});
