import { useState } from 'react';
import { definePreview } from '../../preview-contract';
import { Switch, switchStates, switchVariants } from './index';
import type { SwitchState } from './index';
import '../../tokens/color.css';
import '../../tokens/layout.css';
import '../../tokens/effects.css';
import styles from './Switch.module.css';

function isSwitchState(value: string): value is SwitchState {
  return switchStates.some((state) => state === value);
}

function SwitchDemo({ state }: { state: SwitchState }) {
  const [checked, setChecked] = useState(state === 'on' || state === 'busy');

  return (
    <Switch
      busy={state === 'busy'}
      checked={checked}
      description="Demandées uniquement après votre activation."
      disabled={state === 'disabled'}
      label="Notifications natives"
      onCheckedChange={setChecked}
    />
  );
}

const switchPreview = definePreview({
  id: 'switch',
  title: 'Switch',
  category: 'Primitives',
  level: 'primitive',
  purpose: 'Activer immédiatement un réglage avec un curseur liquid glass distinct des facettes.',
  variants: [...switchVariants],
  states: [...switchStates],
  fixtures: ['Notifications natives', 'Demandées uniquement après votre activation.'],
  sources: [
    { label: 'API publique', path: 'components/switch/index.ts' },
    { label: 'Contrat', path: 'components/switch/switch.contract.ts' },
    { label: 'Implémentation', path: 'components/switch/Switch.tsx' },
    { label: 'Styles', path: 'components/switch/Switch.module.css' },
    { label: 'Preview', path: 'components/switch/Switch.preview.tsx' },
    { label: 'Tests', path: 'components/switch/Switch.test.tsx' },
  ],
  dependencies: ['Icon', 'color tokens', 'layout tokens', 'effects tokens', 'preview-contract'],
  accessibility: [
    'Le bouton expose role switch et aria-checked',
    'Le libellé et la description nomment le contrôle',
    'Espace et Entrée déclenchent le changement natif du bouton',
    'Busy bloque une seconde activation et expose aria-busy',
    'Le focus reste visible autour de la piste',
  ],
  usage: `import { Switch } from '@tobirink/ui';`,
  render: ({ state }) => {
    const selectedState: SwitchState = isSwitchState(state) ? state : 'off';

    return (
      <section className={styles.preview} data-state={selectedState}>
        <header className={styles.previewHeader}>
          <div>
            <p className={styles.eyebrow}>Primitive · Réglage</p>
            <h3>Un effet immédiat</h3>
          </div>
          <span className={styles.index}>Liquid / direct</span>
        </header>

        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Composition</h4>
          <div className={styles.sample}>
            <SwitchDemo key={selectedState} state={selectedState} />
          </div>
        </section>

        <p className={styles.rule}>La lentille glisse et se déforme. Le texte reste fixe, net et hors de l’effet.</p>
      </section>
    );
  },
});

export default switchPreview;
