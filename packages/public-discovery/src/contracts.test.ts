import { describe, expect, it } from 'vitest';
import { publicDiscoveryQuerySchema } from '.';

const query = {
  discoveryTitles: ['One'],
  mediaKind: 'ANIME' as const,
  sourceTitles: ['One'],
};

describe('public discovery request minimization', () => {
  it.each(['discoveryTitles', 'sourceTitles'] as const)('rejects more than four %s', (field) => {
    expect(publicDiscoveryQuerySchema.safeParse({ ...query, [field]: ['One', 'Two', 'Three', 'Four', 'Five'] }).success).toBe(false);
  });

  it('accepts four titles in each bounded list', () => {
    const titles = ['One', 'Two', 'Three', 'Four'];
    expect(publicDiscoveryQuerySchema.safeParse({ ...query, discoveryTitles: titles, sourceTitles: titles }).success).toBe(true);
  });
});
