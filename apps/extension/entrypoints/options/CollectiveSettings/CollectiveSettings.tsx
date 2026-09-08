import { useState } from 'react';
import { Button, Surface } from '@tobirink/ui';
import styles from './CollectiveSettings.module.css';

export interface CollectiveSettingsProps {
  status: 'loading' | 'unavailable' | 'disabled' | 'pending' | 'enabled' | 'revoking' | 'revoked';
  busy: boolean;
  error: boolean;
  invitation?: string | undefined;
  onEnable(): void;
  onRevoke(): void;
  onPair(): void;
  onRedeem(invitation: string): void;
}
export function CollectiveSettings(props: CollectiveSettingsProps) {
  const [consent, setConsent] = useState(false);
  const [invitation, setInvitation] = useState('');
  const unavailable = props.status === 'unavailable' || props.status === 'loading';
  return <section aria-labelledby="collective-settings-title" className={styles.section}>
    <Surface>
      <div className={styles.content}>
        <h2 id="collective-settings-title">Retrouver mes correspondances sur mes appareils</h2>
        <p>Le collectif conserve les empreintes des noms analysés et les identifiants publics des œuvres. Ces empreintes peuvent être devinées. Vos titres, liens, dossiers et progression restent dans l’extension.</p>
        {unavailable ? <p role="status">{props.status === 'loading' ? 'Lecture des préférences…' : 'Le service collectif n’est pas configuré pour cette version.'}</p> : null}
        {props.status === 'enabled' || props.status === 'revoking' ? <>
          <p role="status">{props.status === 'revoking' ? 'Révocation à terminer.' : 'Collectif activé. Seuls vos choix humains confirment une correspondance pour les autres propriétaires.'}</p>
          <div className={styles.actions}>
            <Button disabled={props.busy || props.status === 'revoking'} onClick={props.onPair}>Appairer un appareil</Button>
            <Button disabled={props.busy} onClick={props.onRevoke} variant="danger">Révoquer pour tous mes appareils</Button>
          </div>
          <p>La révocation bloque les futurs accès et contributions. Les associations déjà envoyées restent conservées.</p>
          {props.invitation ? <label className={styles.field}>Invitation valable cinq minutes, à saisir uniquement dans votre autre extension<input readOnly value={props.invitation} /></label> : null}
        </> : <>
          <label className={styles.consent}><input checked={consent} disabled={props.busy || unavailable} onChange={(event) => setConsent(event.currentTarget.checked)} type="checkbox" />J’accepte l’envoi de ces empreintes et identifiants au collectif.</label>
          <Button disabled={!consent || props.busy || unavailable} onClick={props.onEnable} variant="primary">Activer le collectif</Button>
          <label className={styles.field}>Invitation de mon autre appareil<input autoComplete="off" disabled={props.busy || unavailable} maxLength={101} onChange={(event) => setInvitation(event.currentTarget.value)} value={invitation} /></label>
          <Button disabled={!consent || props.busy || unavailable || !/^[a-f0-9-]{36}:[a-f0-9]{64}$/u.test(invitation)} onClick={() => props.onRedeem(invitation)}>Appairer cette installation</Button>
        </>}
        {props.error ? <p role="alert">L’opération n’a pas abouti. Réessayez ; votre bibliothèque locale reste disponible.</p> : null}
      </div>
    </Surface>
  </section>;
}
