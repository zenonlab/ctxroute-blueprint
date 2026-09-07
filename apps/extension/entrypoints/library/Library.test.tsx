import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { libraryStates, libraryVariants } from './index';

const component = readFileSync(new URL('./Library.tsx', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./Library.preview.tsx', import.meta.url), 'utf8');

describe('Library', () => {
  it('publishes the stored surface states', () => {
    expect(libraryVariants).toEqual(['library']);
    expect(libraryStates).toEqual(['ready', 'loading', 'empty', 'review', 'partial', 'offline', 'error', 'blocked']);
  });

  it('keeps the Extension entrypoint as a compatibility adapter', () => {
    expect(component).toContain("export { Library } from '@tobirink/ui'");
    expect(component).toContain("export type { LibraryProps } from '@tobirink/ui'");
  });

  it('implements stored filtering and pagination in the fixture', () => {
    expect(preview).toMatch(/useMemo/);
    expect(preview).toMatch(/setLimit\(\(current\) => current \+ 2\)/);
    expect(preview).toMatch(/setFilters/);
    expect(preview).toMatch(/Téléchargement de l’extension demandé/);
  });

  it('is discoverable with complete Workbench sources', () => {
    expect(preview).toMatch(/id: 'library'/);
    expect(preview).toMatch(/packages\/ui\/src\/features\/library\/library-surface\/Library\.tsx/);
    expect(preview).toContain("import { Library } from '@tobirink/ui'");
  });

  it('keeps the shared member navigation in the Workbench fixture', () => {
    expect(preview).toMatch(/activeId: 'library'/);
  });
});
