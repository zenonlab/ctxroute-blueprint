import { useCallback, useState } from 'react';
import { exportPrivateBackupMessage, restorePrivateBackupMessage } from './private-recovery-messages';

export type PrivateRecoveryState = 'idle' | 'exporting' | 'exported' | 'restoring' | 'restored' | 'error';

export function usePrivateRecovery() {
  const [state, setState] = useState<PrivateRecoveryState>('idle');
  const exportBackup = useCallback(async (passphrase: string) => {
    setState('exporting');
    try {
      const result = await exportPrivateBackupMessage(passphrase);
      const url = URL.createObjectURL(new Blob([result.serialized], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.download = result.filename;
      anchor.href = url;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
      setState('exported');
    } catch { setState('error'); }
  }, []);
  const restoreBackup = useCallback(async (file: File, passphrase: string) => {
    setState('restoring');
    try {
      if (file.size > 18 * 1024 * 1024) throw new Error('backup-too-large');
      await restorePrivateBackupMessage(await file.text(), passphrase);
      setState('restored');
    } catch { setState('error'); }
  }, []);
  return { exportBackup, restoreBackup, state };
}
