import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Button, buttonStates, buttonVariants } from './index';

const css = readFileSync(new URL('./Button.module.css', import.meta.url), 'utf8');

describe('Button', () => {
  it('keeps variants and states bounded by the UI contract', () => {
    expect(buttonVariants).toEqual(['primary', 'secondary', 'danger', 'quiet']);
    expect(buttonStates).toEqual(['default', 'hover', 'focus', 'disabled', 'busy']);
  });

  it('uses native button behavior and preserves handlers', () => {
    const onClick = vi.fn();
    const button = Button({ children: 'Ajouter', onClick });

    expect(button.type).toBe('button');
    expect(button.props.type).toBe('button');
    expect(button.props.disabled).toBe(false);
    button.props.onClick();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('blocks repeated activation and announces busy state', () => {
    const button = Button({ busy: true, children: 'Ajouter', icon: 'plus' });
    const children = Array.isArray(button.props.children) ? button.props.children : [button.props.children];

    expect(button.props['aria-busy']).toBe(true);
    expect(button.props.disabled).toBe(true);
    expect(JSON.stringify(children)).toContain('loader-circle');
  });

  it('reveals a labelled icon after the text through an expanding slot', () => {
    const button = Button({ children: 'Continuer', icon: 'arrow-right', iconPosition: 'end' });

    expect(JSON.stringify(button.props.children)).toContain('interaction');
    expect(JSON.stringify(button.props.children)).toContain('end');
    expect(css).toMatch(/max-width: 0/);
    expect(css).toMatch(/max-width var\(--motion-duration-standard\)/);
  });

  it('requires a named icon-only control at runtime', () => {
    const button = Button({ 'aria-label': 'Fermer', icon: 'x', iconOnly: true });

    expect(button.props['aria-label']).toBe('Fermer');
    expect(button.props['data-icon-only']).toBe(true);
    expect(button.props.children).toBeTruthy();
    expect(css).toMatch(/\.iconOnly \.iconSlot\[data-position\]/);
  });

  it('keeps an interaction label accessible while revealing it from the left', () => {
    const button = Button({
      children: 'Quitter',
      icon: 'x',
      iconPosition: 'end',
      iconVisibility: 'always',
      labelVisibility: 'interaction',
    });

    expect(button.props['data-label-visibility']).toBe('interaction');
    expect(JSON.stringify(button.props.children)).toContain('Quitter');
    expect(JSON.stringify(button.props.children)).toContain('interaction');
    expect(css).toMatch(/grid-template-columns: minmax\(0, 0fr\)/);
    expect(css).toMatch(/transform-origin: right center/);
  });

  it('uses named tokens and exposes visible focus and reduced motion', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/gi);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/var\(--color-focus\)/);
    expect(css).toMatch(/@media \(hover: none\)/);
    expect(css).toMatch(/data-visibility='interaction'/);
    expect(css).toMatch(/backdrop-filter: blur\(var\(--space-3\)\)/);
    expect(css).toMatch(/scale\(var\(--button-hover-scale\)\)/);
    expect(css).toMatch(/@supports not/);
    expect(css).not.toMatch(/linear-gradient/);
  });
});
