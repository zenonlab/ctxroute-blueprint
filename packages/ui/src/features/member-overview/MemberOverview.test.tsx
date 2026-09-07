import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const component = readFileSync(new URL('./MemberOverview.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./MemberOverview.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./MemberOverview.preview.tsx', import.meta.url), 'utf8');
describe('MemberOverview', () => { it('shares Library and Agenda Workbench variants without another navigation shell', () => { expect(component).toContain('variant="library"'); expect(component).toContain('variant="agenda"'); expect(component).toContain('layout="centered"'); expect(component).not.toContain('MemberNavigation'); expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))'); expect(preview).toContain("id: 'member-overview'"); }); });
