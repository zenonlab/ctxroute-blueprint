import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agendaStates, agendaVariants, createAgendaDays, createLocalAgendaPeriod } from './index';

const component = readFileSync(new URL('./Agenda.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./Agenda.module.css', import.meta.url), 'utf8');

describe('shared Agenda surface', () => {
  it('publishes the Workbench contract and seven-day rail', () => {
    expect(agendaVariants).toEqual(['timeline']);
    expect(agendaStates).toEqual(['ready', 'loading', 'empty', 'partial', 'offline', 'error', 'blocked']);
    expect(component).toContain('MemberNavigation');
    expect(component).toContain('WorkCard');
    expect(component).toContain('FeedbackState');
    expect(component).toContain('Semaine précédente');
    expect(component).toContain('Semaine suivante');
    expect(component).toContain('tabIndex={0}');
    expect(css).toMatch(/grid-template-columns: repeat\(7, minmax\(11\.25rem, 1fr\)\)/);
    expect(css).toMatch(/overflow-x: auto/);
  });

  it('builds Monday-first complete weeks and local-time releases', () => {
    const period = createLocalAgendaPeriod(new Date(2026, 8, 9, 12), 0);
    expect(period.days).toHaveLength(7);
    expect(period.days[0]?.date.getDay()).toBe(1);
    const occursAt = new Date(2026, 8, 9, 18).toISOString();
    const days = createAgendaDays(period, { items: [{ availability: 'estimated', id: 'agenda_release', occursAt, release: 'Épisode 1', source: 'Source locale', title: 'Frieren' }] });
    expect(days.flatMap((day) => day.releases)[0]).toMatchObject({ precision: 'Horaire estimé', title: 'Frieren' });
  });

  it('uses only named tokens and exposes all private data states', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/iu);
    expect(component).toContain("state === 'partial'");
    expect(component).toContain("state === 'offline'");
    expect(component).toContain("state === 'empty'");
    expect(component).toContain('Semaine vide');
    expect(component).toContain("state === 'error'");
  });
});
