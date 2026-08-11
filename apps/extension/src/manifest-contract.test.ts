import { describe,expect,it } from 'vitest';
import config from '../wxt.config.js';

describe('extension page recognition permissions',()=>{
  it.each(['chrome','firefox'])('can read a synthetic active HTTP(S) tab URL in %s when the popup is opened',(browser)=>{
    expect(config.manifest({browser}).permissions).toContain('activeTab');
  });
});
