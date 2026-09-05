import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { navigationStates, navigationVariants } from './index';

const component = readFileSync(new URL('./Navigation.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./Navigation.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./Navigation.preview.tsx', import.meta.url), 'utf8');

describe('Navigation', () => {
  it('bounds the three FavLib navigation formats', () => {
    expect(navigationVariants).toEqual(['primary', 'tabs', 'compact']);
    expect(navigationStates).toEqual(['default', 'focus']);
  });

  it('announces active links and tabs through native semantics', () => {
    expect(component).toMatch(/aria-current={active \? 'page' : undefined}/);
    expect(component).toMatch(/aria-selected={active}/);
    expect(component).toMatch(/aria-controls={item\.controlsId}/);
    expect(component).toMatch(/id={item\.tabId}/);
    expect(component).toMatch(/role="tab"/);
    expect(component).toMatch(/tabIndex={active \? 0 : -1}/);
  });

  it('implements the horizontal roving focus convention', () => {
    expect(component).toMatch(/props\.kind === 'tabs'/);
    expect(component).toMatch(/event\.key === 'ArrowRight'/);
    expect(component).toMatch(/event\.key === 'ArrowLeft'/);
    expect(component).toMatch(/event\.key === 'Home'/);
    expect(component).toMatch(/event\.key === 'End'/);
    expect(component).toMatch(/tabs\[nextIndex\]\?\.focus\(\)/);
  });

  it('keeps the compact extension layout bounded and touchable', () => {
    expect(css).toMatch(/\.compact/);
    expect(css).toMatch(/grid-auto-columns: minmax\(0, 1fr\)/);
    expect(css).toMatch(/min-height: var\(--size-control-touch\)/);
    expect(css).toMatch(/max-width: 100%/);
    expect(component).toMatch(/Extract<NavigationVariant, 'compact' \| 'tabs'>/);
  });

  it('uses tokens and no state badges or gradients', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/gi);
    expect(css).not.toMatch(/linear-gradient/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(preview).toMatch(/sans badge ni texte d’état supplémentaire/);
  });

  it('publishes an isolated preview and its complete source set', () => {
    expect(preview).toMatch(/id: 'navigation'/);
    expect(preview).toMatch(/NavigationDemo key=/);
    expect(preview).toMatch(/components\/navigation\/Navigation\.tsx/);
  });
});
