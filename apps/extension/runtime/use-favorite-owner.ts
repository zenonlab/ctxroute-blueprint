import { useEffect, useState } from 'react';
import type { CollectiveSettingsProps } from '../entrypoints/options/CollectiveSettings';
import { sendOwnerAction } from './owner-messages';
import type { OwnerAction } from './owner-messages';

export function useFavoriteOwner(): CollectiveSettingsProps {
  const [status, setStatus] = useState<CollectiveSettingsProps['status']>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [invitation, setInvitation] = useState<string>();
  useEffect(() => {
    let active = true;
    void sendOwnerAction({ kind: 'status' }).then((value) => { if (active) setStatus(value.status); }).catch(() => { if (active) { setStatus('unavailable'); setError(true); } });
    return () => { active = false; };
  }, []);
  const run = (action: OwnerAction) => {
    if (busy) return;
    setBusy(true); setError(false); setInvitation(undefined);
    void sendOwnerAction(action).then((value) => { setStatus(value.status); setInvitation(value.invitation); }).catch(() => setError(true)).finally(() => setBusy(false));
  };
  return { status, busy, error, invitation, onEnable: () => run({ kind: 'enable', consent: true }), onRevoke: () => run({ kind: 'revoke' }), onPair: () => run({ kind: 'pair' }), onRedeem: (invitation) => run({ kind: 'redeem', consent: true, invitation }) };
}
