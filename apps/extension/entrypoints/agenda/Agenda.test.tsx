import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agendaStates, agendaVariants } from './index';

const component = readFileSync(new URL('./Agenda.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./Agenda.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./Agenda.preview.tsx', import.meta.url), 'utf8');

describe('Agenda surface', () => {
  it('publishes the calendar states', () => {
    expect(agendaVariants).toEqual(['timeline']);
    expect(agendaStates).toEqual(['ready', 'loading', 'empty', 'partial', 'offline', 'error', 'blocked']);
  });

  it('uses WorkCard as the visual reference without global settings', () => {
    expect(component).toContain('MemberNavigation');
    expect(component).toContain('WorkCard');
    expect(component).not.toContain('AgendaItem');
    expect(component).not.toContain('ReminderControl');
    expect(component).toContain('FeedbackState');
    expect(component).toMatch(/variant="agenda"/);
    expect(component).not.toMatch(/state=.*review/);
  });

  it('keeps the seven-day FavLib reading direction on every viewport', () => {
    expect(component).toContain('days.map');
    expect(component).toContain('Semaine précédente');
    expect(component).toContain('Semaine suivante');
    expect(component).toContain('tabIndex={0}');
    expect(css).toMatch(/grid-template-columns: repeat\(7, minmax\(11\.25rem, 1fr\)\)/);
    expect(css).toMatch(/overflow-x: auto/);
    expect(css).toMatch(/grid-template-columns: repeat\(7, 11\.25rem\)/);
    expect(preview).toContain('Semaine de 7 jours');
    expect(component).not.toContain('>Aucune sortie</p>');
    expect(component).not.toContain('Aucune sortie connue');
    expect(css).not.toContain('.emptyDay');
  });

  it('keeps every certainty explicit in the fixture', () => {
    for (const certainty of ['official', 'confirmed', 'estimated', 'unavailable']) {
      expect(preview).toContain(`availability: '${certainty}'`);
    }
  });

  it('keeps cached offline data usable', () => {
    expect(component).toMatch(/Cache local du/);
    expect(component).toMatch(/state === 'offline'/);
    expect(component).toMatch(/configurez-les dans Réglages/);
  });

  it('uses tokens and approved cover dimensions', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(css).toMatch(/11\.25rem/);
  });

  it('is discoverable with complete Workbench sources', () => {
    expect(preview).toMatch(/id: 'agenda'/);
    expect(preview).toMatch(/entrypoints\/agenda\/Agenda\.tsx/);
  });

  it('uses the shared member navigation without adding Agenda controls to it', () => {
    expect(component).toMatch(/navigation: MemberNavigationConfig/);
    expect(component).toMatch(/<MemberNavigation \{\.\.\.navigation\}>/);
    expect(preview).toMatch(/activeId: 'agenda'/);
  });
});
