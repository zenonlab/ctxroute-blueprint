import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');

describe('personal content preference and parsed favorite title',()=>{
  it('renders a controlled adult opt-in with loading, error and confirmation states',()=>{
    expect(source).toContain("useApi<{allowAdult:boolean}>('/api/v1/preferences/content')");
    expect(source).toContain("JSON.stringify({allowAdult:next})");
    expect(source).toContain('Afficher les œuvres adultes');
    expect(source).toContain('Préférence enregistrée.');
    expect(source).toContain('Impossible de charger la préférence.');
  });

  it('prefers the server-projected parser title and removes the obsolete placeholder',()=>{
    expect(source).toContain("favorite.parsedTitle||favorite.title||'Favori sans titre'");
    expect(source).toContain("item.parsedTitle||item.rawTitle||'Favori sans titre'");
    expect(source).not.toContain('Titre parsé indisponible');
  });
});
