import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { searchFieldStates, searchFieldVariants } from './index';

const component = readFileSync(new URL('./SearchField.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./SearchField.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./SearchField.preview.tsx', import.meta.url), 'utf8');

describe('SearchField', () => {
  it('keeps its purpose and states bounded', () => {
    expect(searchFieldVariants).toEqual(['default']);
    expect(searchFieldStates).toEqual(['empty', 'filled', 'focus', 'disabled']);
  });

  it('uses a labelled native search input and the shared Lucide icon API', () => {
    expect(component).toMatch(/htmlFor={inputId}/);
    expect(component).toMatch(/type="search"/);
    expect(component).toMatch(/<Icon[^>]+name="search"/);
    expect(component).toMatch(/extends Omit<InputHTMLAttributes<HTMLInputElement>/);
  });

  it('removes the input outline while keeping one visible focus treatment', () => {
    expect(css).toMatch(/\.field:focus-within/);
    expect(css).toMatch(/border-color: var\(--color-border-strong\)/);
    expect(css).toMatch(/color: var\(--color-primary\)/);
    expect(css).toMatch(/\.input:focus-visible[\s\S]*outline: none/);
    expect(css).not.toMatch(/linear-gradient/);
    expect(css).not.toMatch(/box-shadow/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/gi);
  });

  it('uses tokens and respects reduced motion', () => {
    expect(css).toMatch(/var\(--size-control-default\)/);
    expect(css).toMatch(/var\(--radius-lg\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });

  it('renders one isolated search field in the workbench preview', () => {
    expect(preview.match(/<SearchField/g)).toHaveLength(1);
    expect(preview).toMatch(/components\/search-field\/SearchField\.tsx/);
    expect(preview).not.toMatch(/invalid|valid|error|hint/i);
  });
});
