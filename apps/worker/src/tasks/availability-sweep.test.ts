import { describe, expect, it } from 'vitest';
import sweep from './availability-sweep.js';

describe('availability sweep', () => {
  it('queues only matched personal bookmark targets with a dedupe key', async () => {
    const jobs: unknown[] = [];
    const helpers = { query: async () => ({ rows: [{ userId: 'u1', mediaId: 'm1', rawTarget: 'https://source.test/series/synthetic-work/chapter-1', workUrl: 'https://source.test/series/synthetic-work', parserId:'shared-parser',parserVersion:11,parserFingerprint:'synthetic-fingerprint',domain: 'source.test' }] }), addJob: async (...args: unknown[]) => { jobs.push(args); } };
    expect(await sweep({}, helpers)).toBe(1);
    expect(jobs[0]).toEqual(['availability', expect.objectContaining({ scopeKey: 'm1:source.test:https://source.test/series/synthetic-work',target:'https://source.test/series/synthetic-work',rawTarget:'https://source.test/series/synthetic-work/chapter-1',workUrl:'https://source.test/series/synthetic-work',workUrlProvenance:expect.objectContaining({source:'bookmark-parse-artifact',rawUrl:'https://source.test/series/synthetic-work/chapter-1'}),connectorVersion:'4',policy: { approvedDomains: ['source.test'] }}), expect.objectContaining({ jobKey: 'availability:public:v4:m1:source.test:https://source.test/series/synthetic-work' })]);
  });
  it('shares public targets while retaining a private device scope', async () => {
    const jobs: unknown[] = [];
    const helpers = { query: async () => ({ rows: [
      { userId: 'alice', mediaId: 'm1', deviceId: null, rawTarget: 'https://source.test/1/chapter-2',workUrl:'https://source.test/1', domain: 'source.test' },
      { userId: 'bob', mediaId: 'm1', deviceId: null, rawTarget: 'https://source.test/1/chapter-3',workUrl:'https://source.test/1', domain: 'source.test' },
      { userId: 'alice', mediaId: 'm2', deviceId: 'device-1', rawTarget: 'https://private.test/2/chapter-4',workUrl:'https://private.test/2', domain: 'private.test' },
    ] }), addJob: async (...args: unknown[]) => { jobs.push(args); } };
    expect(await sweep({}, helpers)).toBe(2);
    expect((jobs[0] as any[])[1]).toMatchObject({ scopeKey: 'm1:source.test:https://source.test/1' });
    expect(jobs).toHaveLength(1);
    expect((jobs[0] as any[])[2]).toMatchObject({ jobKey: 'availability:public:v4:m1:source.test:https://source.test/1' });
  });
});
