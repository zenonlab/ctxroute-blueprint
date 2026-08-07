import { describe, expect, it } from 'vitest';
import sweep from './availability-sweep.js';

describe('availability sweep', () => {
  it('queues only matched personal bookmark targets with a dedupe key', async () => {
    const jobs: unknown[] = [];
    const helpers = { query: async () => ({ rows: [{ userId: 'u1', mediaId: 'm1', target: 'https://source.test/1', domain: 'source.test' }] }), addJob: async (...args: unknown[]) => { jobs.push(args); } };
    expect(await sweep({}, helpers)).toBe(1);
    expect(jobs[0]).toEqual(['availability', expect.objectContaining({ scopeKey: 'm1:source.test:https://source.test/1', policy: { approvedDomains: ['source.test'] }}), expect.objectContaining({ jobKey: 'availability:public:m1:source.test:https://source.test/1' })]);
  });
  it('shares public targets while retaining a private device scope', async () => {
    const jobs: unknown[] = [];
    const helpers = { query: async () => ({ rows: [
      { userId: 'alice', mediaId: 'm1', deviceId: null, target: 'https://source.test/1', domain: 'source.test' },
      { userId: 'bob', mediaId: 'm1', deviceId: null, target: 'https://source.test/1', domain: 'source.test' },
      { userId: 'alice', mediaId: 'm2', deviceId: 'device-1', target: 'https://private.test/2', domain: 'private.test' },
    ] }), addJob: async (...args: unknown[]) => { jobs.push(args); } };
    expect(await sweep({}, helpers)).toBe(2);
    expect((jobs[0] as any[])[1]).toMatchObject({ scopeKey: 'm1:source.test:https://source.test/1' });
    expect(jobs).toHaveLength(1);
    expect((jobs[0] as any[])[2]).toMatchObject({ jobKey: 'availability:public:m1:source.test:https://source.test/1' });
  });
});
