import { definePreview } from '../../preview-contract';
import { Button, buttonStates, buttonVariants } from './index';
import type { ButtonState, ButtonVariant } from './index';
import '../../tokens/color.css';
import '../../tokens/layout.css';
import '../../tokens/effects.css';
import styles from './Button.module.css';

function isButtonVariant(value: string): value is ButtonVariant {
  return buttonVariants.some((variant) => variant === value);
}

function isButtonState(value: string): value is ButtonState {
  return buttonStates.some((state) => state === value);
}

const buttonPreview = definePreview({
  id: 'button',
  title: 'Button',
  category: 'Primitives',
  level: 'primitive',
  purpose: 'Déclencher une action explicite avec une hiérarchie stable.',
  variants: [...buttonVariants],
  states: [...buttonStates],
  fixtures: ['Action progressive', 'Action de sortie compacte'],
  sources: [
    { label: 'API publique', path: 'components/button/index.ts' },
    { label: 'Contrat', path: 'components/button/button.contract.ts' },
    { label: 'Implémentation', path: 'components/button/Button.tsx' },
    { label: 'Styles', path: 'components/button/Button.module.css' },
    { label: 'Preview', path: 'components/button/Button.preview.tsx' },
    { label: 'Tests', path: 'components/button/Button.test.tsx' },
  ],
  dependencies: ['Icon', 'color tokens', 'layout tokens', 'effects tokens', 'preview-contract'],
  accessibility: [
    'Le bouton natif conserve le clavier et le nom accessible',
    'Le focus visible ne dépend pas de la couleur de fond',
    'Busy est annoncé avec aria-busy et bloque les activations répétées',
    'Icon-only exige un aria-label explicite',
    'Un libellé révélé reste présent dans le nom accessible au repos',
  ],
  usage: `import { Button } from '@tobirink/ui';`,
  render: ({ state, variant }) => {
    const selectedVariant: ButtonVariant = isButtonVariant(variant) ? variant : 'secondary';
    const selectedState: ButtonState = isButtonState(state) ? state : 'default';
    const disabled = selectedState === 'disabled';
    const busy = selectedState === 'busy';

    return (
      <section className={styles.preview} data-state={selectedState}>
        <header className={styles.previewHeader}>
          <div>
            <p className={styles.eyebrow}>Primitive · Action</p>
            <h3>Une action, une hiérarchie</h3>
          </div>
          <span className={styles.index}>HTML / button</span>
        </header>

        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Composition</h4>
          <div className={styles.samples}>
            <Button busy={busy} disabled={disabled} icon="arrow-right" iconPosition="end" variant={selectedVariant}>Continuer</Button>
            <Button busy={busy} disabled={disabled} icon="x" iconPosition="end" iconVisibility="always" labelVisibility="interaction" variant={selectedVariant}>Quitter</Button>
          </div>
        </section>

        <p className={styles.rule}>Le verre reste uniforme : l’action révèle son icône à droite ou son libellé à gauche.</p>
      </section>
    );
  },
});

export default buttonPreview;
