import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { facetSelectStates, facetSelectVariants, facetSelectionStates } from './index';

const component = readFileSync(new URL('./FacetSelect.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./FacetSelect.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./FacetSelect.preview.tsx', import.meta.url), 'utf8');

describe('FacetSelect', () => {
  it('bounds the visual and tri-state contracts', () => {
    expect(facetSelectVariants).toEqual(['default']);
    expect(facetSelectStates).toEqual(['closed', 'open', 'included', 'excluded', 'focus', 'disabled']);
    expect(facetSelectionStates).toEqual(['include', 'exclude']);
  });

  it('uses a custom button menu and no native select', () => {
    expect(component).not.toMatch(/<select/);
    expect(component).toMatch(/aria-expanded={open}/);
    expect(component).toMatch(/data-facet-option/);
    expect(component).toMatch(/aria-pressed={state !== undefined}/);
    expect(component).not.toMatch(/className={styles\.stateLabel}/);
  });

  it('cycles neutral, included and excluded with Lucide icons', () => {
    expect(component).toMatch(/current === undefined/);
    expect(component).toMatch(/current === 'include'/);
    expect(component).toMatch(/delete next\[optionValue\]/);
    expect(component).toMatch(/'check'.*'x'.*'circle'/s);
  });

  it('supports arrows, Escape and focus restoration', () => {
    expect(component).toMatch(/event\.key === 'ArrowDown'/);
    expect(component).toMatch(/event\.key === 'ArrowUp'/);
    expect(component).toMatch(/event\.key === 'Escape'/);
    expect(component).toMatch(/triggerRef\.current\?\.focus\(\)/);
    expect(component).toMatch(/rootRef\.current\?\.contains\(document\.activeElement\)/);
  });

  it('reuses SearchField and filters options without changing selections', () => {
    expect(component).toMatch(/import \{ SearchField \} from '\.\.\/search-field'/);
    expect(component).toMatch(/option\.label\.toLocaleLowerCase\('fr'\)\.includes\(normalizedQuery\)/);
    expect(component).toMatch(/label={`Rechercher dans \$\{label\}`}/);
    expect(component).toMatch(/visibleOptions\.length === 0/);
    expect(component).toMatch(/event\.target instanceof HTMLInputElement/);
  });

  it('uses tokens, reduced motion and the Button visual direction', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/gi);
    expect(css).toMatch(/backdrop-filter: blur\(var\(--space-3\)\)/);
    expect(css).toMatch(/var\(--color-primary-soft\)/);
    expect(css).toMatch(/var\(--color-danger-soft\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).not.toMatch(/linear-gradient/);
  });

  it('shows the custom component and every planned state in Monaco', () => {
    expect(preview).toMatch(/id: 'facet-select'/);
    expect(preview).toMatch(/components\/facet-select\/FacetSelect\.tsx/);
    expect(preview).toMatch(/FacetDemo key={selectedState}/);
  });
});
