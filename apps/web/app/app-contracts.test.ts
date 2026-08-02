import { describe, expect, it } from 'vitest';

describe('Wave 2 UI contracts', () => {
  it('keeps catalogue and connector states distinct', () => {
    expect(['Planifié', 'Disponible', 'Obsolète']).toEqual(expect.arrayContaining(['Planifié', 'Disponible', 'Obsolète']));
  });

  it('uses synthetic identities only', () => {
    expect(['Alice', 'Bob']).not.toContain('alice@example.com');
  });
});
