import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { statusStates, statusTones } from './index';

const status = readFileSync(new URL('./Status.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./Status.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./Status.preview.tsx', import.meta.url), 'utf8');

describe('Status', () => {
  it('bounds tones and states', () => {
    expect(statusTones).toEqual(['neutral', 'accent', 'success', 'warning', 'danger']);
    expect(statusStates).toEqual(['default', 'live']);
  });

  it('keeps Status meaning outside its decorative dot', () => {
    expect(status).toMatch(/aria-hidden="true" className={styles.dot}/);
    expect(status).toMatch(/children: string \| number/);
    expect(status).toMatch(/<span>{children}<\/span>/);
    expect(status).not.toMatch(/<Icon|<svg/);
  });

  it('announces only when explicitly requested', () => {
    expect(status).toMatch(/live = 'off'/);
    expect(status).toMatch(/aria-live={announces \? live : undefined}/);
    expect(status).toMatch(/live === 'assertive' \? 'alert' : 'status'/);
  });

  it('uses a borderless text and dot treatment', () => {
    expect(status).toMatch(/styles.status/);
    expect(css).not.toMatch(/\.badge|indicator-soft/);
    expect(css.match(/\.status\s*\{([^}]*)\}/)?.[1] ?? '').not.toMatch(/border:|background:/);
    expect(css).toMatch(/\.dot[\s\S]*background: currentColor/);
  });

  it('publishes the primitive and its sources without Badge', () => {
    expect(preview).toMatch(/id: 'status'/);
    expect(preview).not.toMatch(/Badge/);
    expect(preview.match(/<Status/g)).toHaveLength(1);
    expect(preview).toMatch(/components\/status\/Status\.tsx/);
  });
});
