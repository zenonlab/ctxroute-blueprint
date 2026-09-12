import { useCallback, useEffect, useState } from 'react';
import type { ResolutionStatusProps } from '../entrypoints/options/ResolutionStatus';
import { readResolutionStatus, writeDiagnosticsEnabled } from './resolution-status-messages';

export function useResolutionStatus(): ResolutionStatusProps {
  const [state, setState] = useState<ResolutionStatusProps['state']>('loading');
  const [counts, setCounts] = useState<ResolutionStatusProps['counts']>();
  const [inventory, setInventory] = useState<ResolutionStatusProps['inventory']>();
  const [diagnostics, setDiagnostics] = useState<ResolutionStatusProps['diagnostics']>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setState('loading');
    void readResolutionStatus().then((value) => {
      if (active) { setCounts(value.counts); setDiagnostics(value.diagnostics); setInventory(value.inventory); setState('ready'); }
    }).catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, [revision]);
  const onRefresh = useCallback(() => setRevision((value) => value + 1), []);
  const onReconcile = useCallback(() => {
    setState('running');
    void readResolutionStatus(true).then((value) => {
      setCounts(value.counts); setDiagnostics(value.diagnostics); setInventory(value.inventory); setState('ready');
    }).catch(() => setState('error'));
  }, []);
  const onDiagnosticsToggle = useCallback(() => {
    if (diagnostics === undefined) return;
    setState('running');
    void writeDiagnosticsEnabled(!diagnostics.enabled).then((value) => {
      setCounts(value.counts); setDiagnostics(value.diagnostics); setInventory(value.inventory); setState('ready');
    }).catch(() => setState('error'));
  }, [diagnostics]);
  return { counts, diagnostics, inventory, onDiagnosticsToggle, onReconcile, onRefresh, state };
}
