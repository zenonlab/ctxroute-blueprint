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

  it('keeps the Extension entrypoint as a compatibility adapter', () => {
    expect(component).toContain("export { Agenda } from '@tobirink/ui'");
    expect(component).toContain("export type { AgendaProps } from '@tobirink/ui'");
  });

  it('keeps the seven-day FavLib reading direction on every viewport', () => {
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

  it('uses tokens and approved cover dimensions', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(css).toMatch(/11\.25rem/);
  });

  it('is discoverable with complete Workbench sources', () => {
    expect(preview).toMatch(/id: 'agenda'/);
    expect(preview).toMatch(/entrypoints\/agenda\/Agenda\.tsx/);
  });

  it('keeps Agenda selected in the Extension preview', () => {
    expect(preview).toMatch(/activeId: 'agenda'/);
  });
});
