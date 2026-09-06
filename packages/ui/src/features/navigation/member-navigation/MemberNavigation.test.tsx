import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { memberNavigationStates, memberNavigationVariants } from './index';

const component = readFileSync(new URL('./MemberNavigation.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./MemberNavigation.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./MemberNavigation.preview.tsx', import.meta.url), 'utf8');

describe('MemberNavigation', () => {
  it('bounds its responsive contract and Review states', () => {
    expect(memberNavigationVariants).toEqual(['responsive']);
    expect(memberNavigationStates).toEqual(['default', 'reviews']);
  });

  it('composes one shared desktop and mobile navigation', () => {
    expect(component.match(/<Navigation/g)).toHaveLength(2);
    expect(component).toMatch(/Navigation principale/);
    expect(component).toMatch(/Navigation mobile/);
    for (const label of ['Accueil', 'Bibliothèque', 'Agenda']) expect(component).toContain(label);
    expect(component).toMatch(/routes\?\.home \?\? '#home'/);
    expect(component).toMatch(/routes\?\.library \?\? '#library'/);
    expect(component).toMatch(/routes\?\.agenda \?\? '#agenda'/);
  });

  it('submits search and delegates Review to the shared resolver', () => {
    expect(component).toMatch(/onSearch\(query\.trim\(\)\)/);
    expect(component).toMatch(/setReviewOpen\(\(open\) => !open\)/);
    expect(component).toMatch(/aria-label="Correspondances à vérifier"/);
    expect(component).toMatch(/icon="bell"/);
    expect(component).not.toMatch(/<Dialog/);
    expect(component).toMatch(/role="dialog"/);
    expect(component).toMatch(/data-review-state={review\.resolver\.state}/);
    expect(component).toMatch(/reviewIsEmpty \? null/);
    expect(component).toMatch(/aria-label={reviewIsEmpty \? 'Correspondances à vérifier' : undefined}/);
    expect(component).toMatch(/document\.addEventListener\('pointerdown'/);
    expect(component).toMatch(/event\.key !== 'Escape'/);
    expect(component).toMatch(/querySelector<HTMLButtonElement>\('button'\)\?\.focus/);
    expect(component).not.toMatch(/description="Choisissez/);
    expect(component).toMatch(/<ReviewResolver \{\.\.\.review\.resolver\}/);
    expect(component).toMatch(/aria-describedby={reviewCountId}/);
    expect(component).not.toMatch(/browser\.|chrome\.|indexedDB|fetch\(/);
  });

  it('keeps the FavLib shell, counted trigger and narrow resolver bounded', () => {
    expect(component).toMatch(/<TobirinkLogo className={styles\.brandLogo}/);
    expect(component).not.toMatch(/<svg|brandGold|brandNavy|brandPaper/);
    expect(component).toMatch(/normalizedCount > 99 \? '99\+' : normalizedCount/);
    expect(component).toMatch(/normalizedCount > 0/);
    expect(css).toMatch(/min-height: var\(--size-control-touch\)/);
    expect(css).toMatch(/width: var\(--size-control-touch\)/);
    expect(css).toMatch(/max-width: var\(--size-content-wide\)/);
    expect(css).toMatch(/position: sticky/);
    expect(css).toMatch(/\.reviewPanel::before/);
    expect(css).toMatch(/\.reviewPanel\[data-review-state='empty'\][\s\S]*var\(--size-column-min\) \+ var\(--space-8\) \* 3/);
    expect(css).toMatch(/\.reviewPanelBody[\s\S]*overflow: auto/);
    expect(css).toMatch(/\.reviewButton\[class\]\[aria-expanded='true'\]/);
    expect(css).toMatch(/\.reviewButton\[class\] \{[\s\S]*background: transparent/);
    expect(component).toMatch(/className={styles\.reviewTrigger}[\s\S]*className={styles\.reviewPanel}/);
    expect(css).toMatch(/var\(--size-column-min\) \* 3/);
    expect(css).toMatch(/min-width: 0/);
    expect(css).toMatch(/max-width: 48rem/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/gi);
  });

  it('publishes a complete interactive Workbench preview', () => {
    expect(preview).toMatch(/id: 'member-navigation'/);
    expect(preview).toMatch(/state === 'default' \? 0 : 3/);
    expect(preview).toMatch(/Décision enregistrée/);
    expect(preview).toMatch(/Review passée pour le moment/);
    expect(preview).toMatch(/ReviewResolver/);
    expect(preview).toMatch(/Recherche : \$\{query\}/);
  });
});
