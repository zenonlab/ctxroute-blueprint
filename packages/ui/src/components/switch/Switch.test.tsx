import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { switchStates, switchVariants } from './index';

const component = readFileSync(new URL('./Switch.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./Switch.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./Switch.preview.tsx', import.meta.url), 'utf8');

describe('Switch', () => {
  it('bounds the visual contract to immediate settings', () => {
    expect(switchVariants).toEqual(['default']);
    expect(switchStates).toEqual(['off', 'on', 'focus', 'disabled', 'busy']);
    expect(preview).toMatch(/Réglage/);
    expect(preview).not.toMatch(/facette de sélection/);
  });

  it('uses a native button with switch semantics', () => {
    expect(component).toMatch(/<button/);
    expect(component).toMatch(/role="switch"/);
    expect(component).toMatch(/aria-checked={checked}/);
    expect(component).toContain('onClick={() => onCheckedChange(!checked)}');
  });

  it('associates its label and optional description', () => {
    expect(component).toMatch(/aria-labelledby={labelId}/);
    expect(component).toMatch(/aria-describedby={description \? descriptionId : undefined}/);
    expect(component).toMatch(/id={descriptionId}/);
  });

  it('blocks interaction and announces busy state', () => {
    expect(component).toMatch(/aria-busy={busy \|\| undefined}/);
    expect(component).toMatch(/disabled={disabled \|\| busy}/);
    expect(component).not.toMatch(/<Icon|<svg|loader-circle/);
    expect(css).toMatch(/\.busy \.thumb/);
  });

  it('keeps the liquid effect on the thumb and respects reduced motion', () => {
    expect(css).toMatch(/\.thumb/);
    expect(css).toMatch(/backdrop-filter: blur\(var\(--space-2\)\) saturate\(140%\)/);
    expect(css).toMatch(/background: color-mix\(in srgb, var\(--color-text-muted\) 76%, transparent\)/);
    expect(css).toMatch(/\.root\[aria-checked='true'\] \.thumb[\s\S]*background: color-mix\(in srgb, var\(--color-primary\) 78%, transparent\)/);
    expect(css.match(/\.thumb\s*\{([^}]*)\}/)?.[1] ?? '').not.toMatch(/border:/);
    expect(css).toMatch(/--switch-thumb-stretch: 1\.18/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    const copyRule = css.match(/\.copy\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(copyRule).not.toMatch(/backdrop-filter/);
  });

  it('publishes every state and source in the workbench', () => {
    expect(preview).toMatch(/id: 'switch'/);
    expect(preview).toMatch(/components\/switch\/Switch\.tsx/);
    expect(preview).toMatch(/SwitchDemo key={selectedState}/);
  });
});
