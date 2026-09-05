import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reviewStates, reviewVariants } from './index';

const component = readFileSync(new URL('./Review.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./Review.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./Review.preview.tsx', import.meta.url), 'utf8');

describe('Review surface', () => {
  it('publishes every relevant local state', () => {
    expect(reviewVariants).toEqual(['resolution']);
    expect(reviewStates).toEqual(['ready', 'loading', 'empty', 'partial', 'offline', 'error', 'conflict']);
  });

  it('keeps the resolver exclusively inside the header trigger', () => {
    expect(component).toContain('MemberNavigation');
    expect(component).toContain('FeedbackState');
    expect(component).not.toContain('ReviewResolver');
    expect(component).not.toMatch(/<h1|className={styles\.queue}|File de Review/);
    expect(component).not.toContain('WorkCard');
    expect(component).not.toContain('Favori original');
    expect(component).not.toContain('ReviewCandidateCard');
    expect(component).not.toContain('ReviewDecisionForm');
    expect(component).toMatch(/aria-label="Review"/);
    expect(component).toMatch(/layout="centered"/);
    expect(component).toMatch(/icon="bell"/);
  });

  it('delegates every Review state through the member navigation config', () => {
    expect(component).toMatch(/<MemberNavigation \{\.\.\.navigation\}>/);
    expect(component).toMatch(/data-state={state}/);
    expect(preview).toMatch(/resolver:/);
    expect(preview).toMatch(/onNext: \(\) => selectIndex/);
    expect(preview).toMatch(/onPrevious: \(\) => selectIndex/);
    expect(preview).toMatch(/setResult\(null\)/);
    expect(component).not.toMatch(/currentRevision|selectedReviewId|onSubmitDecision|queue:/);
  });

  it('explains every standalone state instead of leaving a blank page', () => {
    expect(component).toMatch(/Review est intégrée aux notifications/);
    expect(component).toMatch(/Aucune correspondance à vérifier/);
    expect(component).toMatch(/Certaines métadonnées manquent/);
    expect(component).toMatch(/Review reste disponible hors ligne/);
    expect(component).toMatch(/La correspondance a changé/);
    expect(component).toMatch(/Préparation de Review…/);
    expect(component).toMatch(/Review ne peut pas être relue/);
  });

  it('contains no collective contribution path', () => {
    expect(component).not.toMatch(/collective|contribution|signal/i);
    expect(preview).not.toMatch(/collective|contribution|signal/i);
  });

  it('uses tokens and leaves candidate dimensions to the resolver', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(css).not.toMatch(/11\.25rem/);
    expect(css).toMatch(/place-items: center/);
    expect(css).toMatch(/\.preview \.review[\s\S]*min-height: calc\(var\(--size-column-min\) \* 2\)/);
  });

  it('keeps the global Review trigger outside the candidate WorkCards', () => {
    expect(component).toMatch(/navigation: MemberNavigationConfig/);
    expect(component).toMatch(/<MemberNavigation \{\.\.\.navigation\}>/);
    expect(preview).toMatch(/count: queue\.length/);
    expect(preview).toMatch(/La cloche adjacente à la recherche/);
    expect(preview).not.toMatch(/Favori (Firefox|Chrome)/);
  });
});
