import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./effects.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./effects.preview.tsx', import.meta.url), 'utf8');

describe('effect tokens', () => {
  it('keeps the radius scale short and bounded', () => {
    expect(css.match(/--radius-(?:sm|md|lg):\s*\d+px/g)).toEqual([
      '--radius-sm: 2px',
      '--radius-md: 4px',
      '--radius-lg: 8px',
    ]);
  });

  it('exposes only three elevation roles', () => {
    expect(css.match(/--shadow-[\w-]+:/g)).toEqual([
      '--shadow-flat:',
      '--shadow-raised:',
      '--shadow-overlay:',
    ]);
  });

  it('bounds motion and disables it when reduced motion is requested', () => {
    const durations = ['fast', 'standard', 'slow'].map((name) => {
      const value = css.match(new RegExp(`--motion-duration-${name}:\\s*(\\d+)ms`))?.[1];
      if (!value) throw new Error(`Missing motion duration: ${name}`);
      return Number(value);
    });
    expect(durations).toEqual([120, 180, 240]);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css.match(/--motion-duration-(?:fast|standard|slow):\s*0ms/g)).toHaveLength(3);
  });

  it('keeps the preview atomic and free of inline styles', () => {
    expect(preview).not.toMatch(/button|biblioth[eè]que|navigation|workcard|media.?card/i);
    expect(preview).not.toMatch(/style\s*=/i);
  });
});
