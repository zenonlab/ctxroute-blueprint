import { describe,expect,it,vi } from 'vitest';
import { acquireLease } from './lease.js';
describe('PostgreSQL source lease',()=>{it('uses an atomic upsert and reports contention',async()=>{const db={query:vi.fn().mockResolvedValueOnce({rowCount:1}).mockResolvedValueOnce({rowCount:0})};expect(await acquireLease(db,'public|fixture|orbital','worker-a')).toBe(true);expect(await acquireLease(db,'public|fixture|orbital','worker-b')).toBe(false);expect(db.query.mock.calls[0][0]).toContain('ON CONFLICT(scope_key)');});});
