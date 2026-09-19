import { describe, expect, it } from 'vitest';
import { createLocalAgendaQueue } from './local-agenda-queue';

describe('local Agenda generation ownership', () => {
  it('serializes three windows through load projection and read, including after failure', async () => {
    const queue = createLocalAgendaQueue();
    const steps: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let cache = '';
    const first = queue.enqueue(async () => { cache = 'week-1'; steps.push('load-1'); await gate; steps.push(`project-${cache}`); return cache; });
    const second = queue.enqueue(async () => { steps.push('load-2'); throw new Error('503'); });
    const rejected = expect(second).rejects.toThrow('503');
    const third = queue.enqueue(async () => { cache = 'week-3'; steps.push(`project-${cache}`); return cache; });
    await Promise.resolve();
    expect(steps).toEqual(['load-1']);
    release();
    expect(await first).toBe('week-1');
    await rejected;
    expect(await third).toBe('week-3');
    expect(steps).toEqual(['load-1', 'project-week-1', 'load-2', 'project-week-3']);
  });
});
