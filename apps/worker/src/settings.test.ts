import { describe,expect,it } from 'vitest';
import { OPERATIONAL_DEFAULTS } from '@favlib/config';
import { operationalValue } from './settings.js';
describe('worker operational settings',()=>{it('uses a valid persisted override and falls back safely',async()=>{expect(await operationalValue({query:async()=>({rows:[{value:1234}]})},'timeouts.providerMs')).toBe(1234);expect(await operationalValue({query:async()=>({rows:[{value:999}]})},'timeouts.providerMs')).toBe(OPERATIONAL_DEFAULTS['timeouts.providerMs']);expect(await operationalValue({query:async()=>({rows:[]})},'timeouts.providerMs')).toBe(OPERATIONAL_DEFAULTS['timeouts.providerMs'])})});
