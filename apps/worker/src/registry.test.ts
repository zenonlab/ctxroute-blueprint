import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WORKER_TASK_NAMES, parseCrontab, SCHEDULES } from './registry.js';

describe('worker deployment contract', () => {
  it('keeps every scheduled task registered and scheduled', () => {
    const cron = parseCrontab(readFileSync(new URL('../crontab', import.meta.url), 'utf8'));
    for (const name of Object.keys(SCHEDULES)) { expect(WORKER_TASK_NAMES).toContain(name); expect(cron).toContain(name); }
  });
});
