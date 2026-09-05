import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./layout.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./layout.preview.tsx', import.meta.url), 'utf8');

function pixelToken(name: string): number {
  const value = css.match(new RegExp(`--${name}:\\s*(\\d+)px`))?.[1];
  if (!value) throw new Error(`Missing pixel token: ${name}`);
  return Number(value);
}

describe('layout tokens', () => {
  it('keeps the spacing scale bounded and ordered', () => {
    const scale = ['space-1', 'space-2', 'space-3', 'space-4', 'space-6', 'space-8'].map(pixelToken);
    expect(scale).toEqual([4, 8, 12, 16, 24, 32]);
  });

  it('keeps the type scale bounded and ordered', () => {
    const scale = ['font-size-meta', 'font-size-label', 'font-size-caption', 'font-size-body', 'font-size-section', 'font-size-title', 'font-size-display'].map(pixelToken);
    expect(scale).toEqual([10, 11, 12, 14, 18, 24, 32]);
  });

  it('reserves a 44px minimum touch target', () => {
    expect(pixelToken('size-control-touch')).toBeGreaterThanOrEqual(44);
  });

  it('uses named pixel values outside foundation declarations', () => {
    const rules = css.replace(/^\s*--[\w-]+:\s*[^;]+;\s*$/gm, '');
    expect(rules.match(/\b\d+px\b/g) ?? []).toEqual([]);
  });

  it('keeps the preview free of product components and inline styles', () => {
    expect(preview).not.toMatch(/biblioth[eè]que|navigation|workcard|media.?card/i);
    expect(preview).not.toMatch(/style\s*=/i);
  });
});
