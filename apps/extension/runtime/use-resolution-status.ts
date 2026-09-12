import { useCallback, useEffect, useState } from 'react';
import type { ResolutionStatusProps } from '../entrypoints/options/ResolutionStatus';
import { readResolutionStatus, writeDiagnosticsEnabled, writeResolutionControl } from './resolution-status-messages';

export function useResolutionStatus(): ResolutionStatusProps {
  const [state, setState] = useState<ResolutionStatusProps['state']>('loading');
  const [counts, setCounts] = useState<ResolutionStatusProps['counts']>();
  const [controller, setController] = useState<ResolutionStatusProps['controller']>();
  const [inventory, setInventory] = useState<ResolutionStatusProps['inventory']>();
  const [diagnostics, setDiagnostics] = useState<ResolutionStatusProps['diagnostics']>();
  const apply = useCallback((value: Awaited<ReturnType<typeof readResolutionStatus>>) => {
    setController(value.controller); setCounts(value.counts); setDiagnostics(value.diagnostics); setInventory(value.inventory); setState('ready');
  }, []);
  const refresh = useCallback((showLoading = false) => {
    if (showLoading) setState('loading');
    void readResolutionStatus().then(apply).catch(() => setState('error'));
  }, [apply]);
  useEffect(() => { refresh(true); }, [refresh]);
  useEffect(() => {
    const active = controller?.state === 'inventory' || controller?.state === 'presence' || controller?.state === 'resolving' || controller?.state === 'waiting-provider';
    if (!active) return;
    const delay = controller.state === 'waiting-provider' ? 30_000 : 2_000;
    const interval = window.setInterval(() => refresh(), delay);
    return () => window.clearInterval(interval);
  }, [controller?.state, refresh]);
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refresh]);
  const onRefresh = useCallback(() => refresh(true), [refresh]);
  const onReconcile = useCallback(() => {
    setState('running');
    void readResolutionStatus(true).then((value) => {
      apply(value);
    }).catch(() => setState('error'));
  }, [apply]);
  const onControl = useCallback((action: 'pause' | 'resume' | 'retry-blocked') => {
    setState('running');
    void writeResolutionControl(action).then(apply).catch(() => setState('error'));
  }, [apply]);
  const onDiagnosticsToggle = useCallback(() => {
    if (diagnostics === undefined) return;
    setState('running');
    void writeDiagnosticsEnabled(!diagnostics.enabled).then((value) => {
      apply(value);
    }).catch(() => setState('error'));
  }, [apply, diagnostics]);
  return { controller, counts, diagnostics, inventory, onControl, onDiagnosticsToggle, onReconcile, onRefresh, state };
}
