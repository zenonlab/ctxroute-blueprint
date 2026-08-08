import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { WORKER_TASK_NAMES, ROLE_SCHEDULES, ROLE_TASK_NAMES } from './registry.js';
import { scheduleRecurring } from './index.js';

describe('worker deployment contract', () => {
  it('keeps every role schedule registered without a Graphile crontab', () => {
    const cron = readFileSync(new URL('../crontab', import.meta.url), 'utf8').trim();
    expect(cron).toBe('');
    for (const schedules of Object.values(ROLE_SCHEDULES)) {
      for (const name of Object.keys(schedules)) expect(WORKER_TASK_NAMES).toContain(name);
    }
  });
  it('runs the AniList calendar only in the isolated reading worker',()=>{
    const source=readFileSync(new URL('./index.ts',import.meta.url),'utf8');
    expect(source.split("'anilist-calendar-sweep': async").length-1).toBe(1);
    expect(source.split("'enrichment-sweep': async").length-1).toBe(1);
    expect(source.split("'mangaupdates-release-sweep': async").length-1).toBe(1);
  });
  it('assigns every recurring task to exactly one role and keeps provider sweeps in reading',()=>{
    const all=Object.keys(ROLE_SCHEDULES.all),reading=Object.keys(ROLE_SCHEDULES.reading);
    expect(all.filter(name=>reading.includes(name))).toEqual([]);
    expect(reading).toContain('anilist-calendar-sweep');
    expect(reading).toContain('mangaupdates-release-sweep');
    expect(ROLE_TASK_NAMES.all).not.toContain('anilist-calendar-sweep');
    expect(ROLE_TASK_NAMES.reading).toEqual(expect.arrayContaining(['anilist-enrichment','mangaupdates-enrichment']));
    expect(ROLE_TASK_NAMES.reading).not.toContain('manual-review-provider');
    expect(ROLE_TASK_NAMES.interactive).toEqual(['manual-review-provider']);
    expect(ROLE_TASK_NAMES.all).not.toContain('anilist-enrichment');
  });
  it('does not enqueue every schedule on each thirty-second heartbeat',()=>{
    const source=readFileSync(new URL('./index.ts',import.meta.url),'utf8');
    expect(source).toContain('now>=(nextRuns.get(name)??0)');
    expect(source).not.toContain('Object.entries(SCHEDULES).map');
  });
  it('schedules only when no active, deferred or pending instance exists',async()=>{
    const query=vi.fn().mockResolvedValue({rows:[]});
    await scheduleRecurring({query},'anilist-calendar-sweep');
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0]).toContain('WHERE NOT EXISTS');
    expect(query.mock.calls[0][0]).toContain('t.identifier=$1');
    expect(query.mock.calls[0][0]).not.toContain("job_key_mode := 'replace'");
  });
});
