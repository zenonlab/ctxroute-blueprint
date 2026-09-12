import { describe, expect, it } from 'vitest';
import { catalogue } from './discovery';

describe('catalogue discovery', () => {
  it('contains every planned UI objective without duplicate identifiers', () => {
    const ids = catalogue.map((item) => item.id);

    expect(catalogue).toHaveLength(27);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('review-decision-form');
    expect(ids).not.toContain('reminder-control');
    expect(ids).not.toContain('progress-control');
    expect(ids).toContain('member-navigation');
    expect(ids).toContain('review-resolver');
    expect(ids).toContain('resolution-status');
    expect(ids).toContain('review');
    expect(ids).toContain('button');
    expect(catalogue.find((item) => item.id === 'popup')?.status).toBe('implemented');
    expect(catalogue.find((item) => item.id === 'popup')?.render).toBeTypeOf('function');
    expect(catalogue.find((item) => item.id === 'popup')?.presentation).toBe('popup');
    expect(catalogue.find((item) => item.id === 'settings')?.presentation).toBe('page');
    expect(catalogue.find((item) => item.id === 'agenda')?.presentation).toBe('page');
    expect(catalogue.find((item) => item.id === 'work-card')?.presentation).toBe('component');
  });
});
