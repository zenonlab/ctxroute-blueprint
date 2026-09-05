import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { surfaceStates, surfaceVariants } from './index';

const surface = readFileSync(new URL('./Surface.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./Surface.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./Surface.preview.tsx', import.meta.url), 'utf8');

describe('Surface', () => {
  it('bounds its structural variants and states', () => {
    expect(surfaceVariants).toEqual(['plain', 'raised', 'outlined']);
    expect(surfaceStates).toEqual(['default', 'interactive', 'disabled']);
  });

  it('keeps header, content and footer in document order', () => {
    expect(surface.indexOf('styles.header')).toBeLessThan(surface.indexOf('styles.content'));
    expect(surface.indexOf('styles.content')).toBeLessThan(surface.indexOf('styles.footer'));
  });

  it('uses an opt-in semantic element without inventing card behavior', () => {
    expect(surface).toMatch(/as: Element = 'div'/);
    expect(surface).toMatch(/'article' \| 'div' \| 'section'/);
    expect(surface).toMatch(/inert={state === 'disabled' \? true : undefined}/);
    expect(surface).not.toMatch(/onClick|href|poster|tilt|badge/i);
  });

  it('uses shared tokens for the FavLib-derived panel treatment', () => {
    expect(css).toMatch(/background: var\(--color-surface\)/);
    expect(css).toMatch(/border: var\(--size-border\) solid var\(--color-border\)/);
    expect(css).toMatch(/border-radius: var\(--radius-md\)/);
    expect(css).not.toMatch(/#[\da-f]{3,8}|rgba?\(/i);
  });

  it('documents the boundary between Surface and domain cards', () => {
    expect(preview).toMatch(/id: 'surface'/);
    expect(preview).toMatch(/Aucun poster, badge ou mouvement de carte/);
    expect(preview).not.toMatch(/id: 'surface-card'/);
  });
});
