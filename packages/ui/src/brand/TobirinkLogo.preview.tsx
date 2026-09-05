import { definePreview } from '../preview-contract';
import '../tokens/color.css';
import '../tokens/layout.css';
import { TobirinkLogo } from './index';
import styles from './TobirinkLogo.module.css';

const tobirinkLogoPreview = definePreview({
  id: 'tobirink-logo',
  title: 'Logo Tobirink',
  category: 'Fondations',
  level: 'foundation',
  purpose: 'Afficher sans reconstruction le logo officiel hérité de FavLib.',
  variants: ['officiel'],
  states: ['default'],
  fixtures: ['/icons/tobirink-128.png'],
  sources: [
    { label: 'API publique', path: 'brand/index.ts' },
    { label: 'Logo', path: 'brand/TobirinkLogo.tsx' },
    { label: 'Styles de preview', path: 'brand/TobirinkLogo.module.css' },
    { label: 'Preview', path: 'brand/TobirinkLogo.preview.tsx' },
    { label: 'Tests', path: 'brand/TobirinkLogo.test.tsx' },
  ],
  dependencies: ['logo PNG officiel FavLib', 'color tokens', 'layout tokens'],
  accessibility: [
    'Le logo est décoratif et accompagné du nom Tobirink visible',
    'Le fichier source conserve ses proportions sans recadrage',
  ],
  usage: `import { TobirinkLogo } from '@tobirink/ui';`,
  render: () => (
    <section aria-label="Marque Tobirink" className={styles.preview}>
      <TobirinkLogo className={styles.logo} />
      <span className={styles.name}>Tobirink</span>
    </section>
  ),
});

export default tobirinkLogoPreview;
