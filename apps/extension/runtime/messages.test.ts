import { describe, expect, it } from 'vitest';
import { agendaPeriodResponseSchema, extensionMessageSchema, libraryPageResponseSchema, librarySearchResponseSchema, organizerConfigurationResponseSchema, organizerPreviewResponseSchema, quickPreferencesResponseSchema, reviewCandidatesResponseSchema, reviewDecisionResponseSchema, reviewQueueResponseSchema } from './messages';

const organizerConfiguration = {
  folders: [{
    children: [],
    conditions: { editorialStatuses: [], mediaTypes: ['MANGA'], progressStates: [] },
    enabled: true,
    id: 'manga',
    name: 'Manga',
  }],
  id: 'organizer',
  updatedAt: '2026-09-06T00:00:00.000Z',
};

describe('extension Review messages', () => {
  it('accepts only the exact versioned queue read command', () => {
    expect(extensionMessageSchema.safeParse({ type: 'review.queue.read', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ extra: true, type: 'review.queue.read', version: 1 }).success).toBe(false);
    expect(extensionMessageSchema.safeParse({ type: 'review.queue.read', version: 2 }).success).toBe(false);
    expect(extensionMessageSchema.safeParse({ reviewId: 'review_source1', type: 'review.candidates.read', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ decision: { kind: 'candidate', workId: 'work_candidate1' }, reviewId: 'review_source1', revision: 'review-v1-current', type: 'review.decision.write', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ decision: { kind: 'manual', source: 'url', value: 'javascript:alert(1)' }, reviewId: 'review_source1', revision: 'review-v1-current', type: 'review.decision.write', version: 1 }).success).toBe(true);
  });

  it('bounds candidate snapshots and decision responses', () => {
    expect(reviewCandidatesResponseSchema.safeParse({ ok: true, snapshot: {
      candidates: [{ candidateId: 'work_candidate1', href: 'https://reader.example/one', mediaType: 'anime', provider: 'anilist', providerId: '1', title: 'One' }],
      reviewId: 'review_source1', revision: 'review-v1-current', state: 'ready', title: 'One',
    } }).success).toBe(true);
    expect(reviewCandidatesResponseSchema.safeParse({ ok: true, snapshot: {
      candidates: [{ candidateId: 'work_candidate1', href: 'javascript:alert(1)', mediaType: 'anime', provider: 'local', providerId: '1', title: 'One' }],
      reviewId: 'review_source1', revision: 'review-v1-current', state: 'ready', title: 'One',
    } }).success).toBe(false);
    expect(reviewDecisionResponseSchema.safeParse({ ok: false, error: 'conflict' }).success).toBe(true);
  });

  it('bounds and validates the serializable pending snapshot', () => {
    expect(reviewQueueResponseSchema.safeParse({
      ok: true,
      snapshot: { items: [{ id: 'review_source1', sourceLabel: 'https://reader.example/1', title: 'Titre' }], status: 'pending' },
    }).success).toBe(true);
    expect(reviewQueueResponseSchema.safeParse({
      ok: true,
      snapshot: { items: Array.from({ length: 101 }, (_, index) => ({ id: `review_${index}`, sourceLabel: 'source', title: 'Titre' })), status: 'pending' },
    }).success).toBe(false);
    expect(reviewQueueResponseSchema.safeParse({
      ok: true,
      snapshot: { items: [{ id: 'invalid', sourceLabel: '', title: '' }], status: 'pending' },
    }).success).toBe(false);
  });
});

describe('extension Agenda messages', () => {
  it('validates period commands and bounded local projections', () => {
    expect(extensionMessageSchema.safeParse({ from: '2026-09-07T00:00:00.000Z', to: '2026-09-14T00:00:00.000Z', type: 'agenda.period.read', version: 1 }).success).toBe(true);
    expect(agendaPeriodResponseSchema.safeParse({
      ok: true,
      snapshot: {
        items: [{ availability: 'official', id: 'agenda_release-one', mediaType: 'anime', occursAt: '2026-09-08T10:00:00.000Z', release: 'Episode 1', source: 'anilist', sourceUrl: 'https://reader.example/frieren/29', title: 'Frieren', workId: 'work_frieren-one' }],
        missingWorkIds: [],
        source: 'local',
        updatedAt: '2026-09-06T08:00:00.000Z',
      },
    }).success).toBe(true);
    expect(agendaPeriodResponseSchema.safeParse({
      ok: true,
      snapshot: { items: [{ availability: 'official', id: 'agenda_release-one', mediaType: 'anime', occursAt: '2026-09-08T10:00:00.000Z', release: 'Episode 1', source: 'anilist', sourceUrl: 'javascript:alert(1)', title: 'Frieren', workId: 'work_frieren-one' }], missingWorkIds: [], source: 'local', updatedAt: '2026-09-06T08:00:00.000Z' },
    }).success).toBe(false);
    expect(agendaPeriodResponseSchema.safeParse({ ok: true, snapshot: { items: Array.from({ length: 101 }, () => ({})), missingWorkIds: [] } }).success).toBe(false);
  });
});

describe('extension quick preference messages', () => {
  it('accepts only the two persisted preference keys', () => {
    const preferences = { nativeNotifications: true, showEstimatedReleases: false };
    expect(extensionMessageSchema.safeParse({ type: 'preferences.quick.read', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ preferences, type: 'preferences.quick.write', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ preferences: { ...preferences, extra: true }, type: 'preferences.quick.write', version: 1 }).success).toBe(false);
    expect(quickPreferencesResponseSchema.safeParse({ ok: true, preferences }).success).toBe(true);
  });
});

describe('extension Library messages', () => {
  it('validates bounded page commands and serializable responses', () => {
    expect(extensionMessageSchema.safeParse({ type: 'library.page.read', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ afterId: 'work_library-one', type: 'library.page.read', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ afterId: 'invalid', type: 'library.page.read', version: 1 }).success).toBe(false);
    expect(libraryPageResponseSchema.safeParse({
      ok: true,
      snapshot: {
        items: [{ id: 'work_library-one', mediaType: 'manga', source: 'anilist', title: 'Frieren' }],
        missingWorkIds: [],
      },
    }).success).toBe(true);
    expect(libraryPageResponseSchema.safeParse({
      ok: true,
      snapshot: { items: Array.from({ length: 25 }, () => ({ id: 'work_library-one', mediaType: 'manga', source: 'local', title: 'Titre' })), missingWorkIds: [] },
    }).success).toBe(false);
  });

  it('validates bounded local search commands and results', () => {
    expect(extensionMessageSchema.safeParse({ query: 'Frieren', type: 'library.search.read', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ query: 'Frieren', type: 'search.open', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ query: '', type: 'search.open', version: 1 }).success).toBe(false);
    expect(librarySearchResponseSchema.safeParse({ ok: true, snapshot: { items: [{ id: 'work_library-one', mediaType: 'manga', source: 'local', title: 'Frieren' }], truncated: false } }).success).toBe(true);
  });
});

describe('extension Organizer messages', () => {
  it('validates local read, write and preview commands', () => {
    expect(extensionMessageSchema.safeParse({ type: 'organizer.configuration.read', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ configuration: organizerConfiguration, type: 'organizer.configuration.write', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ configuration: organizerConfiguration, type: 'organizer.preview.read', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ configuration: { ...organizerConfiguration, id: 'other' }, type: 'organizer.configuration.write', version: 1 }).success).toBe(false);
    expect(extensionMessageSchema.safeParse({
      configuration: { ...organizerConfiguration, folders: Array.from({ length: 101 }, (_, index) => ({ children: [], enabled: true, id: `folder-${index}`, name: 'Folder' })) },
      type: 'organizer.configuration.write',
      version: 1,
    }).success).toBe(false);
  });

  it('bounds serialized configuration and preview responses', () => {
    expect(organizerConfigurationResponseSchema.safeParse({ configuration: organizerConfiguration, ok: true }).success).toBe(true);
    expect(organizerPreviewResponseSchema.safeParse({
      ok: true,
      snapshot: {
        inspectedCount: 1,
        items: [{ action: 'move', bookmarkId: 'bookmark-1', destination: ['Manga'], ruleId: 'manga', title: 'Frieren' }],
        state: 'ready',
        truncated: false,
      },
    }).success).toBe(true);
    expect(organizerPreviewResponseSchema.safeParse({
      ok: true,
      snapshot: { inspectedCount: 501, items: [], state: 'ready', truncated: false },
    }).success).toBe(false);
  });
});
