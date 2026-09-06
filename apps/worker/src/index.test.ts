import { describe, expect, it } from 'vitest';
import { isPublicSiteRoute } from './index';

describe('public site fallback', () => {
  it('allows only declared static routes and one public work identifier', () => {
    expect(['/', '/library', '/agenda', '/privacy', '/download', '/library/work_1'].every(isPublicSiteRoute)).toBe(true);
    expect(['/v1/releases', '/downloads/archive.zip', '/library/a/b', '/unknown'].some(isPublicSiteRoute)).toBe(false);
  });
});
