import { definePreview } from '../../preview-contract';
import '../../tokens/color.css';
import '../../tokens/layout.css';
import '../../tokens/effects.css';
import { Surface, surfaceStates, surfaceVariants } from './index';
import type { SurfaceState, SurfaceVariant } from './index';
import styles from './Surface.module.css';

function isVariant(value: string): value is SurfaceVariant {
  return surfaceVariants.some((variant) => variant === value);
}

function isState(value: string): value is SurfaceState {
  return surfaceStates.some((state) => state === value);
}

const surfacePreview = definePreview({
  id: 'surface',
  title: 'Surface',
  category: 'Primitives',
  level: 'primitive',
  purpose: 'Regrouper un contenu sans imposer le design d’un composant métier.',
  variants: [...surfaceVariants],
  states: [...surfaceStates],
  fixtures: ['Section de bibliothèque'],
  sources: [
    { label: 'API publique', path: 'components/surface/index.ts' },
    { label: 'Contrat', path: 'components/surface/surface.contract.ts' },
    { label: 'Surface', path: 'components/surface/Surface.tsx' },
    { label: 'Styles', path: 'components/surface/Surface.module.css' },
    { label: 'Preview', path: 'components/surface/Surface.preview.tsx' },
    { label: 'Tests', path: 'components/surface/Surface.test.tsx' },
  ],
  dependencies: ['color tokens', 'layout tokens', 'effects tokens', 'preview-contract'],
  accessibility: [
    'Le composant est neutre par défaut et devient un landmark uniquement via as',
    'Header, contenu puis footer conservent l’ordre de lecture du document',
    'Interactive décrit un groupe contenant un contrôle sans rendre la surface cliquable',
  ],
  usage: `import { Surface } from '@tobirink/ui';`,
  render: ({ state, variant }) => {
    const selectedState: SurfaceState = isState(state) ? state : 'default';
    const selectedVariant: SurfaceVariant = isVariant(variant) ? variant : 'plain';

    return (
      <section className={styles.preview}>
        <header className={styles.previewHeader}>
          <div>
            <p className={styles.eyebrow}>Primitive · Structure</p>
            <h3>Une couche, un rôle</h3>
          </div>
          <span className={styles.index}>Panneau / extension</span>
        </header>

        <div className={styles.examples}>
          <Surface
            as="section"
            aria-label="Exemple de surface"
            footer={<p className={styles.slotLabel}>Pied</p>}
            header={<p className={styles.slotLabel}>En-tête</p>}
            state={selectedState}
            variant={selectedVariant}
          >
            <h4 className={styles.sampleTitle}>Bibliothèque locale</h4>
            <p className={styles.sampleCopy}>La surface organise. Le composant métier garde son identité.</p>
          </Surface>
        </div>

        <p className={styles.rule}>Aucun poster, badge ou mouvement de carte n’appartient à Surface.</p>
      </section>
    );
  },
});

export default surfacePreview;
