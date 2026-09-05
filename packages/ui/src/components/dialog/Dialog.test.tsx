import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dialogSizes, dialogStates, dialogVariants } from './index';

const component = readFileSync(new URL('./Dialog.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./Dialog.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./Dialog.preview.tsx', import.meta.url), 'utf8');

describe('Dialog', () => {
  it('bounds the visible variants and states', () => {
    expect(dialogVariants).toEqual(['default', 'alert']);
    expect(dialogSizes).toEqual(['default', 'wide']);
    expect(dialogStates).toEqual(['open', 'busy']);
  });

  it('offers a token-based wide size for content-rich flows', () => {
    expect(component).toMatch(/size = 'default'/);
    expect(component).toMatch(/data-size={size}/);
    expect(css).toMatch(/\.wide[\s\S]*width: min\(760px/);
  });

  it('uses the native modal contract so the background becomes inert', () => {
    expect(component).toMatch(/<dialog/);
    expect(component).toMatch(/dialog\.showModal\(\)/);
    expect(component).toMatch(/aria-modal="true"/);
    expect(css).toMatch(/\.dialog::backdrop/);
  });

  it('sets initial focus and restores the previous focus', () => {
    expect(component).toMatch(/document\.activeElement instanceof HTMLElement/);
    expect(component).toMatch(/data-dialog-initial-focus/);
    expect(component).toMatch(/returnFocusRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  });

  it('closes through Escape, backdrop or button unless busy', () => {
    expect(component).toMatch(/addEventListener\('cancel', cancel\)/);
    expect(component).toMatch(/addEventListener\('close', close\)/);
    expect(component).toMatch(/if \(busy && open && !dialog\.open\) dialog\.showModal\(\)/);
    expect(component).toMatch(/event\.preventDefault\(\)/);
    expect(component).toMatch(/event\.target === event\.currentTarget/);
    expect(component).toMatch(/if \(!busy\) onOpenChange\(false\)/);
  });

  it('uses tokens, reduced motion and shared primitives', () => {
    expect(component).toMatch(/import \{ Button \} from '\.\.\/button'/);
    expect(component).toMatch(/import \{ Icon \} from '\.\.\/\.\.\/icons'/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/gi);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });

  it('keeps one continuous surface without header or footer separators', () => {
    const headerRule = css.match(/\.header\s*\{([^}]*)\}/)?.[1] ?? '';
    const actionsRule = css.match(/\.actions\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(headerRule).not.toMatch(/border/);
    expect(actionsRule).not.toMatch(/border/);
    expect(css).toMatch(/\.panel[\s\S]*gap: var\(--space-4\)/);
    expect(css).toMatch(/\.panel[\s\S]*padding: var\(--space-4\)/);
  });

  it('uses animated labelled actions with Lucide icons', () => {
    expect(component).toContain('iconPosition="end"');
    expect(component).toContain('labelVisibility="interaction"');
    expect(component).toMatch(/Fermer/);
    expect(component).not.toMatch(/iconOnly/);
    expect(preview).toMatch(/icon="x"[\s\S]*Annuler/);
    expect(preview).toMatch(/icon="check"[\s\S]*Confirmer/);
  });

  it('publishes the isolated preview and all source files', () => {
    expect(preview).toMatch(/id: 'dialog'/);
    expect(preview).toMatch(/DialogDemo key=/);
    expect(preview).toMatch(/components\/dialog\/Dialog\.tsx/);
  });

  it('keeps the workbench preview closed until its trigger is used', () => {
    expect(preview).toMatch(/useState\(false\)/);
    expect(preview).toMatch(/onClick=\{\(\) => setOpen\(true\)\}/);
  });
});
