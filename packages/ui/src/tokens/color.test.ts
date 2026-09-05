import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./color.css', import.meta.url), 'utf8');

function declarations(selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 's'))?.[1] ?? '';
  return new Map([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [match[1] ?? '', match[2] ?? '']));
}

function luminance(value: string): number {
  const channels = value.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

describe.each([
  [':root', declarations(':root')],
  [".color-foundation[data-theme='Clair']", declarations(".color-foundation[data-theme='Clair']")],
])('%s color scheme', (_scheme, tokens) => {
  it.each([
    ['color-text', 'color-canvas'],
    ['color-text', 'color-surface'],
    ['color-text-muted', 'color-surface'],
    ['color-text-on-accent', 'color-primary'],
    ['color-success', 'color-success-soft'],
    ['color-warning', 'color-warning-soft'],
    ['color-danger', 'color-danger-soft'],
  ])('%s remains readable on %s', (foreground, background) => {
    expect(contrast(tokens.get(foreground) ?? '', tokens.get(background) ?? '')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('color foundation boundaries', () => {
  it('uses named colors outside token declarations', () => {
    const rules = css.replace(/^\s*--[\w-]+:\s*#[0-9a-f]{6};\s*$/gim, '');
    expect(rules.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
  });

  it('does not contain product surfaces or domain components', () => {
    const source = readFileSync(new URL('./color.preview.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/biblioth[eè]que|navigation|workcard|media.?card/i);
  });

  it('pairs semantic colors with symbols and labels', async () => {
    const preview = await import('./color.preview');
    const rendered = JSON.stringify(preview.default.render({ state: 'default', variant: 'Sombre' }));
    expect(rendered).toContain('Disponible');
    expect(rendered).toContain('À vérifier');
    expect(rendered).toContain('Interrompu');
  });
});
