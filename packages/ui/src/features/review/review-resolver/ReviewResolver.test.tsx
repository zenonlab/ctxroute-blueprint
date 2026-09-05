import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reviewResolverStates } from './index';

const component = readFileSync(new URL('./ReviewResolver.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./ReviewResolver.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./ReviewResolver.preview.tsx', import.meta.url), 'utf8');

describe('ReviewResolver', () => {
  it('publishes its complete state contract', () => {
    expect(reviewResolverStates).toEqual(['ready', 'loading', 'empty', 'partial', 'offline', 'error', 'conflict', 'success']);
  });

  it('reserves WorkCard for candidates', () => {
    expect(component.match(/<WorkCard/g)).toHaveLength(1);
    expect(component).toMatch(/aria-label="Contexte du favori"/);
    expect(component).toMatch(/item\.candidates\.map/);
    expect(component).toMatch(/className={`\$\{styles\.manualChoice\}/);
    expect(component).not.toMatch(/ReviewCandidateCard|ReviewDecisionForm/);
  });

  it('matches the compact FavLib empty state without redundant copy or shell', () => {
    expect(component).toMatch(/className={styles\.empty}/);
    expect(component).toMatch(/icon="inbox"/);
    expect(component).toMatch(/layout="centered"/);
    expect(component).toMatch(/title="Aucune correspondance à vérifier"/);
    expect(component).not.toMatch(/Aucune Review en attente|Toutes les correspondances ambiguës ont une décision locale/);
    expect(css).toMatch(/\.empty[\s\S]*min-height: calc\(var\(--size-control-touch\) \* 3\)/);
  });

  it('submits candidate, manual and no-match decisions with the revision', () => {
    expect(component).toMatch(/selectLabel: 'Choisir cette œuvre'/);
    expect(component).toMatch(/sourceLabel: 'Voir la source'/);
    expect(component).toMatch(/kind: 'candidate'/);
    expect(component).toMatch(/kind: 'manual'/);
    expect(component).toMatch(/kind: 'none'/);
    expect(component).toMatch(/revision: item\.revision/g);
  });

  it('locks decisions while busy and keeps recovery explicit', () => {
    expect(component).toMatch(/disabled: busy/);
    expect(component).toMatch(/disabled={busy}/g);
    expect(component).toMatch(/aria-busy={busy \|\| undefined}/);
    expect(component).toMatch(/La Review a changé/);
    expect(component).toMatch(/onClick={onRefresh}/);
  });

  it('navigates at the bottom without submitting a decision', () => {
    expect(component).toMatch(/aria-label="Navigation dans les Reviews"/);
    expect(component).toMatch(/aria-label="Review précédente"/);
    expect(component).toMatch(/aria-label="Passer cette Review pour le moment"/);
    expect(component).toMatch(/onClick={onPrevious}/);
    expect(component).toMatch(/onClick={onNext}/);
    expect(component).toMatch(/disabled={busy \|\| !canPrevious}/);
    expect(component).toMatch(/disabled={busy \|\| !canNext}/);
    expect(component).not.toMatch(/onNext.*onSubmitDecision|onPrevious.*onSubmitDecision/);
    expect(css).toMatch(/grid-template-columns: var\(--size-control-touch\) minmax\(0, 1fr\) var\(--size-control-touch\)/);
  });

  it('uses tokens and handles narrow and reduced-motion layouts', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(css).toMatch(/max-width: 32rem/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/grid-template-columns: repeat\(2/);
    expect(css).toMatch(/grid-template-columns: repeat\(3/);
    expect(css).toMatch(/aspect-ratio: 2 \/ 3/);
  });

  it('publishes a complete Workbench preview', () => {
    expect(preview).toMatch(/id: 'review-resolver'/);
    expect(preview).toMatch(/states: \[\.\.\.reviewResolverStates\]/);
    expect(preview).toMatch(/ReviewResolver\.tsx/);
  });
});
