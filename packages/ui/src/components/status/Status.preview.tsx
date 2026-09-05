import { definePreview } from '../../preview-contract';
import { Status, statusStates, statusTones } from './index';
import type { StatusState, StatusTone } from './index';
import '../../tokens/color.css';
import '../../tokens/layout.css';
import '../../tokens/effects.css';
import styles from './Status.module.css';

function isTone(value: string): value is StatusTone {
  return statusTones.some((tone) => tone === value);
}

function isStatusState(value: string): value is StatusState {
  return statusStates.some((state) => state === value);
}

const statusPreview = definePreview({
  id: 'status',
  title: 'Status',
  category: 'Primitives',
  level: 'primitive',
  purpose: 'Exprimer un état sémantique lisible dans les surfaces de l’extension.',
  variants: [...statusTones],
  states: [...statusStates],
  fixtures: ['Disponible'],
  sources: [
    { label: 'API publique', path: 'components/status/index.ts' },
    { label: 'Contrat', path: 'components/status/status.contract.ts' },
    { label: 'Status', path: 'components/status/Status.tsx' },
    { label: 'Styles', path: 'components/status/Status.module.css' },
    { label: 'Preview', path: 'components/status/Status.preview.tsx' },
    { label: 'Tests', path: 'components/status/Status.test.tsx' },
  ],
  dependencies: ['color tokens', 'layout tokens', 'effects tokens', 'preview-contract'],
  accessibility: [
    'Le texte reste obligatoire et porte toujours la signification',
    'Le point de Status est décoratif et masqué aux technologies d’assistance',
    'Une annonce live est activée uniquement à la demande',
  ],
  usage: `import { Status } from '@tobirink/ui';`,
  render: ({ state, variant }) => {
    const tone: StatusTone = isTone(variant) ? variant : 'neutral';
    const selectedState: StatusState = isStatusState(state) ? state : 'default';

    return (
      <section className={styles.preview}>
        <header className={styles.previewHeader}>
          <div>
            <p className={styles.eyebrow}>Primitive · Information</p>
            <h3>Un état, aucun bruit</h3>
          </div>
          <span className={styles.index}>État / extension</span>
        </header>

        <div className={styles.examples}>
          <section className={styles.sample}>
            <Status live={selectedState === 'live' ? 'polite' : 'off'} tone={tone}>Disponible</Status>
          </section>
        </div>

        <p className={styles.rule}>Le point confirme un état. Il ne déclenche aucune action.</p>
      </section>
    );
  },
});

export default statusPreview;
