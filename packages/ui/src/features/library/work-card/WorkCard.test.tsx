import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pointInRect, tiltAt } from './card-motion';
import { workCardStates, workCardVariants } from './index';

const component = readFileSync(new URL('./WorkCard.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./WorkCard.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./WorkCard.preview.tsx', import.meta.url), 'utf8');

describe('WorkCard', () => {
  it('bounds every product context and interaction state', () => {
    expect(workCardVariants).toEqual(['library', 'review', 'agenda', 'active-work']);
    expect(workCardStates).toEqual(['default', 'selected', 'unavailable']);
  });

  it('keeps the historical cover anatomy without badges', () => {
    expect(component).toMatch(/styles\.visual/);
    expect(component).toMatch(/styles\.topline/);
    expect(component).toMatch(/styles\.copy/);
    expect(component).toMatch(/indicator \?\? '- \/ -'/);
    expect(component).not.toMatch(/continueProgress|>Progression</);
    expect(component).not.toMatch(/À vérifier/);
    expect(component).not.toMatch(/Badge|badge/);
    expect(css).toMatch(/aspect-ratio: 2 \/ 3/);
    expect(css).toMatch(/\.active-work \.poster\s*{\s*aspect-ratio: 3 \/ 2/);
  });

  it('limits the FavLib two-action back face to review candidates', () => {
    expect(component).toMatch(/reviewActions/);
    expect(component).toMatch(/variant === 'review' && reviewActions/);
    expect(component).toMatch(/aria-pressed={state === 'selected'}/);
    expect(component).toMatch(/Source de l’œuvre/);
    expect(css).toMatch(/rotateY\(180deg\)/);
    expect(css).toMatch(/grid-template-rows: repeat\(2/);
    expect(css).toMatch(/\.flippable:focus-within \.rotor/);
    expect(css).toMatch(/\.flipped \.rotor/);
    expect(css).toMatch(/\.flippable \.front\s*{\s*pointer-events: none/);
    expect(css).toMatch(/\.back\s*{[^}]*pointer-events: none[^}]*z-index: 1/s);
  });

  it('clamps pointer coordinates and derives FavLib tilt values', () => {
    expect(pointInRect(-5, 150, { left: 0, top: 0, width: 100, height: 100 })).toEqual({ x: 0, y: 1 });
    expect(tiltAt({ x: 0.5, y: 0.5 })).toEqual({ glareX: 50, glareY: 50, shadowX: 0, x: 0, y: 0 });
  });

  it('limits motion to fine pointers and respects reduced motion', () => {
    expect(component).toMatch(/\(hover: hover\) and \(pointer: fine\)/);
    expect(component).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('uses a named link and an accessible cover fallback', () => {
    expect(component).toMatch(/aria-label=.*Ouvrir la source de/);
    expect(component).toMatch(/Couverture indisponible pour/);
    expect(component).toMatch(/role="img"/);
    expect(component).toMatch(/href={href}/);
    expect(component).toMatch(/fallbackIcon\[variant\]/);
  });

  it('publishes one isolated workbench example', () => {
    expect(preview).toMatch(/id: 'work-card'/);
    expect(preview.match(/<WorkCard\s/g)).toHaveLength(1);
    for (const variant of workCardVariants) expect(preview).toContain(variant);
    expect(preview).toMatch(/Seul le candidat Review révèle les actions au dos/);
  });
});
