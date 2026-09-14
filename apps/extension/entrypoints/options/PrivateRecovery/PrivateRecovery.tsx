import { useState } from 'react';
import { Button, Surface } from '@tobirink/ui';
import type { PrivateRecoveryState } from '../../../runtime/use-private-recovery';
import styles from './PrivateRecovery.module.css';

export interface PrivateRecoveryProps {
  state: PrivateRecoveryState;
  onExport(passphrase: string): void;
  onRestore(file: File, passphrase: string): void;
}

export function PrivateRecovery({ onExport, onRestore, state }: PrivateRecoveryProps) {
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportConfirmation, setExportConfirmation] = useState('');
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [restoreFile, setRestoreFile] = useState<File>();
  const [confirmed, setConfirmed] = useState(false);
  const busy = state === 'exporting' || state === 'restoring';
  return <section aria-labelledby="private-recovery-title" className={styles.section}>
    <Surface>
      <div className={styles.content}>
        <h2 id="private-recovery-title">Sauvegarde privée chiffrée</h2>
        <p>Cette archive contient votre bibliothèque, progression, organisation et Review. Elle est chiffrée dans l’extension avec votre phrase secrète, qui n’est ni conservée ni envoyée.</p>
        <div className={styles.group}>
          <h3>Exporter</h3>
          <label className={styles.field}>Phrase secrète, 12 caractères minimum<input autoComplete="new-password" disabled={busy} minLength={12} onChange={(event) => setExportPassphrase(event.currentTarget.value)} type="password" value={exportPassphrase} /></label>
          <label className={styles.field}>Confirmer la phrase secrète<input autoComplete="new-password" disabled={busy} minLength={12} onChange={(event) => setExportConfirmation(event.currentTarget.value)} type="password" value={exportConfirmation} /></label>
          <Button disabled={busy || exportPassphrase.length < 12 || exportPassphrase !== exportConfirmation} onClick={() => onExport(exportPassphrase)} variant="primary">Télécharger la sauvegarde</Button>
        </div>
        <div className={styles.group}>
          <h3>Restaurer</h3>
          <label className={styles.field}>Archive TobiRink<input accept="application/json,.tobirink" disabled={busy} onChange={(event) => setRestoreFile(event.currentTarget.files?.[0])} type="file" /></label>
          <label className={styles.field}>Phrase secrète de l’archive<input autoComplete="current-password" disabled={busy} minLength={12} onChange={(event) => setRestorePassphrase(event.currentTarget.value)} type="password" value={restorePassphrase} /></label>
          <label className={styles.confirm}><input checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.currentTarget.checked)} type="checkbox" />Je confirme le remplacement de l’état privé local par cette archive.</label>
          <Button disabled={busy || !confirmed || restoreFile === undefined || restorePassphrase.length < 12} onClick={() => { if (restoreFile !== undefined) onRestore(restoreFile, restorePassphrase); }} variant="danger">Restaurer cette sauvegarde</Button>
        </div>
        <p aria-live="polite" role="status">{state === 'exporting' ? 'Chiffrement en cours…' : state === 'exported' ? 'Sauvegarde téléchargée.' : state === 'restoring' ? 'Validation et restauration en cours…' : state === 'restored' ? 'Sauvegarde restaurée. La bibliothèque est en cours de vérification.' : state === 'error' ? 'L’opération a échoué. L’état local existant reste intact.' : ''}</p>
      </div>
    </Surface>
  </section>;
}
