import {describe,expect,it,vi} from 'vitest';
import {recoverProviderSlots} from './index.js';

describe('worker startup recovery',()=>{
  it('releases durable provider counters left by a crashed process',async()=>{
    const query=vi.fn().mockResolvedValue({});
    await recoverProviderSlots({query});
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SET in_flight=0'));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("state='FAILED'"));
  });
});
