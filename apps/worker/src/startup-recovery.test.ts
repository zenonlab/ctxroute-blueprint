import {describe,expect,it,vi} from 'vitest';
import {recoverProviderSlots} from './index.js';

describe('worker startup recovery',()=>{
  it('releases durable provider counters left by a crashed process',async()=>{
    const query=vi.fn().mockResolvedValue({rows:[]});
    await recoverProviderSlots({query},'reading');
    expect(query).toHaveBeenCalledWith(expect.stringContaining("owner_service=$1"),['reading']);
    const lockCall=query.mock.calls.find(([statement])=>statement.includes('graphile_worker._private_jobs'))!;
    expect(lockCall[1][0]).toEqual(expect.arrayContaining(['anilist-enrichment','mangaupdates-enrichment']));
  });
  it('releases every predecessor lock for only the restarted role',async()=>{
    const query=vi.fn().mockResolvedValue({rows:[]});
    await recoverProviderSlots({query},'all');
    const lockCall=query.mock.calls.find(([statement])=>statement.includes('graphile_worker._private_jobs'))!;
    expect(lockCall[0]).toContain('locked_at IS NOT NULL');
    expect(lockCall[1][0]).toEqual(expect.arrayContaining(['resolve-favorite']));
    expect(lockCall[1][0]).not.toContain('anilist-enrichment');
    expect(lockCall[1][0]).not.toContain('anilist-calendar-sweep');
  });
  it('keeps interactive recovery scoped to user-triggered provider reviews',async()=>{
    const query=vi.fn().mockResolvedValue({rows:[]});
    await recoverProviderSlots({query},'interactive');
    expect(query).toHaveBeenCalledWith(expect.stringContaining("owner_service=$1"),['interactive']);
    const lockCall=query.mock.calls.find(([statement])=>statement.includes('graphile_worker._private_jobs'))!;
    expect(lockCall[1][0]).toEqual(['manual-review-provider']);
  });
});
