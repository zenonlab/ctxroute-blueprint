import { useCallback, useEffect, useState } from 'react';
import type { ResolutionStatusProps } from '../entrypoints/options/ResolutionStatus';
import { readResolutionStatus } from './resolution-status-messages';

export function useResolutionStatus(): ResolutionStatusProps {
  const [state, setState] = useState<ResolutionStatusProps['state']>('loading');
  const [counts, setCounts] = useState<ResolutionStatusProps['counts']>();
  const [inventory, setInventory] = useState<ResolutionStatusProps['inventory']>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setState('loading');
    void readResolutionStatus().then((value) => {
      if (active) { setCounts(value.counts); setInventory(value.inventory); setState('ready'); }
    }).catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, [revision]);
  const onRefresh = useCallback(() => setRevision((value) => value + 1), []);
  const onReconcile = useCallback(() => {
    setState('running');
    void readResolutionStatus(true).then((value) => {
      setCounts(value.counts); setInventory(value.inventory); setState('ready');
    }).catch(() => setState('error'));
  }, []);
  return { counts, inventory, onReconcile, onRefresh, state };
}
