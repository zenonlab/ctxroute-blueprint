import { describe, expect, it } from 'vitest';
import { canActivate, health, normalizeDomain, previewDeclarative, SourceRegistry, validateDeclarative, type SourceDefinition } from './index.js';

const source: SourceDefinition = { id: 'fixture-anime', domain: 'fixture.test', version: '1.0.0', state: 'ACTIVE', method: 'fixture', featureFlag: 'source.fixture' };

describe('source activation', () => {
  it('normalizes and validates domains without accepting arbitrary hosts', () => {
    expect(normalizeDomain('https://WWW.fixture.test/path')).toBe('fixture.test');
    expect(normalizeDomain('fixture.test.evil.test')).toBe('fixture.test.evil.test');
    expect(normalizeDomain('javascript:alert(1)')).toBeNull();
  });
  it('requires an active source, exact approved domain and feature flag', () => {
    expect(canActivate(source, 'fixture.test', { 'source.fixture': true })).toBe(true);
    expect(canActivate(source, 'other.test', { 'source.fixture': true })).toBe(false);
    expect(canActivate(source, 'fixture.test', { 'source.fixture': false })).toBe(false);
  });
  it('exposes health errors instead of presenting a broken source as absent', () => {
    expect(health(source, 'fixture failed')).toMatchObject({ state: 'ERROR', error: 'fixture failed' });
  });
  it('previews safe declarative selectors without executing code and supports rollback', () => {
    const definition = { sourceId: 'fixture-anime', version: '1', domain: 'fixture.test', page: 'release' as const, titleSelector: 'h1', sequenceSelector: '[data-episode]', linkSelector: '[data-release]', sequencePattern: '(\\d+)' };
    expect(validateDeclarative(definition)).toEqual([]);
    expect(previewDeclarative(definition, '<h1>Fixture</h1><span data-episode="12">12</span><a data-release href="/ep/12">open</a>', 'https://fixture.test/work')).toMatchObject({ ok: true, title: 'Fixture', sequence: '12', url: 'https://fixture.test/ep/12' });
    expect(previewDeclarative(definition, '<h1>Fixture</h1><span data-episode="12">12</span><a data-release href="javascript:alert(1)">open</a>', 'https://fixture.test/work')).toMatchObject({ ok: false, url: null, errors: expect.arrayContaining(['UNSAFE_URL_PROTOCOL']) });
    expect(validateDeclarative({ ...definition, titleSelector: 'script' })).toContain('INVALID_TITLESELECTOR');
    const registry = new SourceRegistry(); registry.stage(definition); registry.stage({ ...definition, version: '2' }); registry.activate('fixture-anime', '2'); expect(registry.rollback('fixture-anime').version).toBe('1');
  });
});
