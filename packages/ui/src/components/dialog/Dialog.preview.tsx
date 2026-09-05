import { useState } from 'react';
import { definePreview } from '../../preview-contract';
import { Button } from '../button';
import '../../tokens/color.css';
import '../../tokens/layout.css';
import '../../tokens/effects.css';
import { Dialog, dialogStates, dialogVariants } from './index';
import type { DialogState, DialogVariant } from './index';
import styles from './Dialog.module.css';

function isVariant(value: string): value is DialogVariant {
  return dialogVariants.some((variant) => variant === value);
}

function isState(value: string): value is DialogState {
  return dialogStates.some((state) => state === value);
}

function DialogDemo({ state, variant }: { state: DialogState; variant: DialogVariant }) {
  const [open, setOpen] = useState(false);
  const busy = state === 'busy';

  return (
    <section className={styles.preview}>
      <Button icon="plus" onClick={() => setOpen(true)} variant="secondary">Ouvrir</Button>
      <Dialog
        actions={(
          <>
            <Button disabled={busy} icon="x" onClick={() => setOpen(false)} variant="secondary">Annuler</Button>
            <Button busy={busy} icon="check" variant={variant === 'alert' ? 'danger' : 'primary'}>Confirmer</Button>
          </>
        )}
        busy={busy}
        description={variant === 'alert' ? 'Cette action demande une confirmation explicite.' : 'Une décision courte, sans quitter le contexte.'}
        onOpenChange={setOpen}
        open={open}
        size={variant === 'default' ? 'wide' : 'default'}
        title={variant === 'alert' ? 'Confirmer l’action' : 'Modifier ce réglage'}
        variant={variant}
      >
        <p>Le contenu reste focalisé. Le fond ne reçoit aucune interaction tant que cette fenêtre est ouverte.</p>
      </Dialog>
    </section>
  );
}

const dialogPreview = definePreview({
  id: 'dialog',
  title: 'Dialog',
  category: 'Primitives',
  level: 'primitive',
  purpose: 'Isoler une décision temporaire sans perdre le contexte ni le focus.',
  variants: [...dialogVariants],
  states: [...dialogStates],
  fixtures: ['Modifier ce réglage', 'Confirmer l’action'],
  sources: [
    { label: 'API publique', path: 'components/dialog/index.ts' },
    { label: 'Contrat', path: 'components/dialog/dialog.contract.ts' },
    { label: 'Implémentation', path: 'components/dialog/Dialog.tsx' },
    { label: 'Styles', path: 'components/dialog/Dialog.module.css' },
    { label: 'Preview', path: 'components/dialog/Dialog.preview.tsx' },
    { label: 'Tests', path: 'components/dialog/Dialog.test.tsx' },
  ],
  dependencies: ['Button', 'Icon', 'color tokens', 'layout tokens', 'effects tokens'],
  accessibility: [
    'Le dialogue modal natif rend le fond inerte et piège le focus',
    'Le focus initial entre dans le dialogue puis revient au déclencheur',
    'Escape et le fond ferment sauf pendant une opération busy',
    'Fermer, Annuler et Confirmer possèdent un texte et une icône Lucide',
  ],
  usage: `import { Dialog } from '@tobirink/ui/components/dialog';`,
  render: ({ state, variant }) => {
    const selectedState = isState(state) ? state : 'open';
    const selectedVariant = isVariant(variant) ? variant : 'default';
    return <DialogDemo key={`${selectedVariant}-${selectedState}`} state={selectedState} variant={selectedVariant} />;
  },
});

export default dialogPreview;
