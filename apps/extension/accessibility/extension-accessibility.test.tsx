import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExtensionSurface } from '../runtime/ExtensionSurface';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const styles = {
  button: read('../../../packages/ui/src/components/button/Button.module.css'),
  dialog: read('../../../packages/ui/src/components/dialog/Dialog.module.css'),
  feedback: read('../../../packages/ui/src/components/feedback-state/FeedbackState.module.css'),
  memberNavigation: read('../../../packages/ui/src/features/navigation/member-navigation/MemberNavigation.module.css'),
  navigation: read('../../../packages/ui/src/components/navigation/Navigation.module.css'),
  popup: read('../entrypoints/popup/Popup.module.css'),
  reviewResolver: read('../../../packages/ui/src/features/review/review-resolver/ReviewResolver.module.css'),
  runtime: read('../runtime/runtime.css'),
  settings: read('../entrypoints/options/Settings.module.css'),
  agenda: read('../entrypoints/agenda/Agenda.module.css'),
  workCard: read('../../../packages/ui/src/features/library/work-card/WorkCard.module.css'),
};

function luminance(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
  const [red = 0, green = 0, blue = 0] = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string) {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

describe('extension accessibility contract', () => {
  it('renders every production surface with a named top-level landmark and no inline styles', () => {
    const surfaces = ['agenda', 'library', 'options', 'popup', 'review'] as const;

    for (const name of surfaces) {
      const markup = renderToStaticMarkup(<ExtensionSurface name={name} />);
      expect(markup).not.toContain('style=');
      expect(markup).toMatch(/<(header|main|section)[^>]+aria-label(?:ledby)?=/);
    }
  });

  it('keeps the Review bell beside and after the named global search in the header', () => {
    const markup = renderToStaticMarkup(<ExtensionSurface name="library" />);
    const search = markup.indexOf('aria-label="Recherche globale"');
    const bell = markup.indexOf('aria-label="Correspondances à vérifier"');

    expect(search).toBeGreaterThan(-1);
    expect(bell).toBeGreaterThan(search);
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).not.toContain('<dialog');
    expect(styles.memberNavigation).toMatch(/\.reviewPanel::before/);
  });

  it('keeps the popup shell and compact tablist available while runtime context loads', () => {
    const markup = renderToStaticMarkup(<ExtensionSurface name="popup" />);

    expect(markup).toContain('<h1>Tobirink</h1>');
    expect(markup).toContain('src="/icons/tobirink-128.png"');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain('role="tablist"');
    expect(markup.match(/role="tab"/g)).toHaveLength(3);
    expect(markup).toContain('aria-controls="popup-page-panel"');
    expect(markup).toContain('aria-labelledby="popup-page-tab"');
    expect(markup).toContain('aria-label="Lecture du contexte local"');
    expect(markup).toContain('Analyse de la page…');
    expect(markup).toContain('Continuer mes œuvres');
    expect(markup).not.toContain('Les Carnets de l’Apothicaire');
  });

  it('meets WCAG AA contrast for the production text, muted text, accent and focus pairs', () => {
    const pairs = [
      ['f4f4f5', '121216'],
      ['a1a1aa', '121216'],
      ['241800', 'ffb224'],
      ['ffd277', '09090b'],
    ] as const;

    for (const [foreground, background] of pairs) {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps narrow surfaces bounded with touch targets and viewport-aware dialogs', () => {
    expect(styles.runtime).toMatch(/body \{ min-width: 320px; \}/);
    expect(styles.runtime).toMatch(/body\[data-surface='popup'\] \{ width: 360px;/);
    expect(styles.memberNavigation).toMatch(/@media \(max-width: 48rem\)/);
    expect(styles.memberNavigation).toMatch(/width: calc\(100vw - var\(--space-8\)\)/);
    expect(styles.navigation).toMatch(/min-height: var\(--size-control-touch\)/);
    expect(styles.dialog).toMatch(/max-width: calc\(100vw - var\(--space-8\) \* 2\)/);
    expect(styles.popup).toMatch(/min-width: calc\(var\(--size-column-min\) \* 2\)/);
    expect(styles.popup).toMatch(/@media \(max-width: 24rem\)/);
    expect(styles.reviewResolver).toMatch(/@media \(max-width: 32rem\)/);
    expect(styles.agenda).toMatch(/grid-template-columns: repeat\(7, 11\.25rem\)/);
    expect(styles.agenda).toMatch(/overflow-x: auto/);
    expect(styles.settings).toMatch(/@media \(max-width: 32rem\)/);
    expect(styles.settings).toMatch(/min-height: var\(--size-control-touch\)/);
  });

  it('preserves visible keyboard focus and removes non-essential reduced-motion transitions', () => {
    for (const css of [styles.button, styles.navigation, styles.workCard]) {
      expect(css).toMatch(/focus-visible/);
    }
    for (const css of [styles.button, styles.dialog, styles.feedback, styles.navigation, styles.workCard]) {
      expect(css).toMatch(/prefers-reduced-motion: reduce/);
    }
    expect(styles.reviewResolver).toMatch(/prefers-reduced-motion: reduce/);
    expect(styles.settings).toMatch(/prefers-reduced-motion: reduce/);
    expect(styles.popup).not.toMatch(/animation|transition/);
  });
});
