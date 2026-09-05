import { definePreview } from '../preview-contract';
import { Icon, iconNames, iconSizes } from './index';
import type { IconSize } from './index';
import '../tokens/color.css';
import '../tokens/layout.css';
import '../tokens/effects.css';

function isIconSize(value: string): value is IconSize {
  return iconSizes.some((candidate) => candidate === value);
}

const iconPreview = definePreview({
  id: 'icons',
  title: 'Icônes',
  category: 'Fondations',
  level: 'foundation',
  purpose: 'Le registre Lucide utile à Tobirink, derrière un trait et trois tailles nommés.',
  variants: [...iconSizes],
  states: ['default'],
  fixtures: [iconNames],
  sources: [
    { label: 'API publique', path: 'icons/index.ts' },
    { label: 'Implémentation', path: 'icons/Icon.tsx' },
    { label: 'Styles', path: 'icons/icon.css' },
    { label: 'Preview', path: 'icons/icon.preview.tsx' },
    { label: 'Tests', path: 'icons/Icon.test.tsx' },
  ],
  dependencies: ['lucide-react', 'color tokens', 'layout tokens', 'effects tokens', 'preview-contract'],
  accessibility: [
    'Une icône décorative est masquée des technologies d’assistance',
    'Une icône informative reçoit un libellé explicite',
    'La couleur suit currentColor et ne porte pas seule le sens',
  ],
  usage: `import { Icon } from '@tobirink/ui';`,
  render: ({ variant }) => {
    const size: IconSize = isIconSize(variant) ? variant : 'md';

    return (
      <section className="icon-foundation">
        <header className="icon-foundation__header">
          <div>
            <p className="icon-foundation__eyebrow">Fondation · Symboles</p>
            <h3>Trait unique</h3>
          </div>
          <span className="icon-foundation__index">SVG / 24</span>
        </header>

        <div className="icon-foundation__grid">
          {iconNames.map((name) => (
            <div className="icon-foundation__sample" key={name}>
              <Icon name={name} size={size} />
              <code>{name}</code>
            </div>
          ))}
        </div>

        <p className="icon-foundation__rule">Trente-huit symboles observés. Un seul fournisseur derrière l’API publique.</p>
      </section>
    );
  },
});

export default iconPreview;
