import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentProps } from 'react';
import type { Agenda } from '../entrypoints/agenda';
import { createAgendaDays, createLocalAgendaPeriod } from './agenda-period-model';
import { readAgendaPeriodMessage } from './messages';

type AgendaModel = Pick<ComponentProps<typeof Agenda>, 'canNext' | 'canPrevious' | 'days' | 'onNext' | 'onPrevious' | 'onRetry' | 'periodLabel' | 'state' | 'updatedAt'>;

export function useLocalAgenda(): AgendaModel {
  const [reference] = useState(() => new Date());
  const [weekOffset, setWeekOffset] = useState(0);
  const [loadKey, setLoadKey] = useState(0);
  const [result, setResult] = useState<Pick<AgendaModel, 'days' | 'state' | 'updatedAt'>>({ days: [], state: 'loading', updatedAt: '' });
  const period = useMemo(() => createLocalAgendaPeriod(reference, weekOffset), [reference, weekOffset]);
  const retry = useCallback(() => setLoadKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    setResult({ days: [], state: 'loading', updatedAt: '' });
    void readAgendaPeriodMessage(period.from, period.to).then((snapshot) => {
      if (!active) return;
      const days = createAgendaDays(period, snapshot);
      const count = days.reduce((total, day) => total + day.releases.length, 0);
      setResult({
        days,
        state: snapshot.missingWorkIds.length > 0 ? 'partial' : count > 0 ? 'ready' : 'empty',
        updatedAt: new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date()),
      });
    }).catch(() => {
      if (active) setResult({ days: [], state: 'error', updatedAt: '' });
    });
    return () => { active = false; };
  }, [loadKey, period]);

  return {
    canNext: true,
    canPrevious: true,
    ...result,
    onNext: () => setWeekOffset((offset) => offset + 1),
    onPrevious: () => setWeekOffset((offset) => offset - 1),
    onRetry: retry,
    periodLabel: period.label,
  };
}
