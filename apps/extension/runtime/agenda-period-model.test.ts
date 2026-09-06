import { describe, expect, it } from 'vitest';
import { createAgendaDays, createLocalAgendaPeriod } from './agenda-period-model';

describe('local Agenda period model', () => {
  it('creates seven Monday-first days and moves by complete weeks', () => {
    const current = createLocalAgendaPeriod(new Date(2026, 8, 9, 12), 0);
    const next = createLocalAgendaPeriod(new Date(2026, 8, 9, 12), 1);
    expect(current.days).toHaveLength(7);
    expect(current.days[0]?.date.getDay()).toBe(1);
    expect(new Date(next.from).valueOf() - new Date(current.from).valueOf()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('groups entries into their local day without empty placeholders', () => {
    const period = createLocalAgendaPeriod(new Date(2026, 8, 9, 12), 0);
    const occursAt = new Date(2026, 8, 9, 18).toISOString();
    const days = createAgendaDays(period, { items: [{ availability: 'official', id: 'agenda_release-one', mediaType: 'anime', occursAt, release: 'Episode 1', source: 'anilist', sourceUrl: 'https://reader.example/frieren/29', title: 'Frieren', workId: 'work_frieren-one' }], missingWorkIds: [] });
    expect(days.flatMap(({ releases }) => releases)).toHaveLength(1);
    expect(days.flatMap(({ releases }) => releases)[0]?.href).toBe('https://reader.example/frieren/29');
    expect(days.filter(({ releases }) => releases.length === 0)).toHaveLength(6);
  });

  it('keeps a release without a local source visible and non-linked', () => {
    const period = createLocalAgendaPeriod(new Date(2026, 8, 9, 12), 0);
    const occursAt = new Date(2026, 8, 9, 18).toISOString();
    const release = createAgendaDays(period, { items: [{ availability: 'official', id: 'agenda_release-one', mediaType: 'anime', occursAt, release: 'Episode 1', source: 'anilist', title: 'Frieren', workId: 'work_frieren-one' }], missingWorkIds: [] }).flatMap((day) => day.releases)[0];
    expect(release).not.toHaveProperty('href');
  });
});
