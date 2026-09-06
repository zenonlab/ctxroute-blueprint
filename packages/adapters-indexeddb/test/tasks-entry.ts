import { DexieTaskStore } from '../src';
const name = `task-contract-${Date.now()}`; let store = new DexieTaskStore(name);
const add = (id: string) => store.enqueue({ id, idempotencyKey: `key:${id}`, kind: 'fixture', payload: '{}' });
const take = async (id: string, token: string) => { await add(id); const task = await store.claimNext(token, '2026-09-04T10:00:00.000Z', '2026-09-04T10:05:00.000Z'); if (task?.id !== id) throw new Error(`Claim mismatch ${id}.`); };
try {
  await take('a-claimed', 'c1'); await take('b-effect', 'c2'); await store.recordEffect('b-effect', 'c2', 'effect:key:b-effect');
  await take('c-committed', 'c3'); await store.recordEffect('c-committed', 'c3', 'effect:key:c-committed'); await store.commit('c-committed', 'c3');
  await take('d-retry', 'c4'); await store.retry('d-retry', 'c4', '2026-09-04T11:00:00.000Z');
  await take('e-blocked', 'c5'); await store.block('e-blocked', 'c5', 'fixture'); await add('z-ready');
  await store.schedule({ id: 'f-scheduled', idempotencyKey: 'key:f-scheduled', kind: 'fixture', payload: '{}' }, '2026-09-04T12:00:00.000Z');
  store.close(); store = new DexieTaskStore(name);
  const states = new Map([['a-claimed', 'CLAIMED'], ['b-effect', 'EFFECT_RECORDED'], ['c-committed', 'COMMITTED'], ['d-retry', 'RETRY_AT'], ['e-blocked', 'BLOCKED'], ['f-scheduled', 'RETRY_AT'], ['z-ready', 'READY']]);
  for (const [id, state] of states) if ((await store.get(id))?.state !== state) throw new Error(`${state} was not persistent.`);
  if ((await store.enqueue({ id: 'duplicate', idempotencyKey: 'key:z-ready', kind: 'fixture', payload: '{}' })).id !== 'z-ready') throw new Error('Idempotency failed.');
  const resumed = await store.claimNext('resumed', '2026-09-04T10:06:00.000Z', '2026-09-04T10:07:00.000Z');
  if (resumed?.id !== 'a-claimed' || resumed.idempotencyKey !== 'key:a-claimed') throw new Error('Expired claim did not resume.');
  document.body.dataset.status = 'passed';
} catch (error) { document.body.dataset.status = 'failed'; document.body.textContent = error instanceof Error ? error.message : String(error); }
finally { await store.deleteDatabase(); }
