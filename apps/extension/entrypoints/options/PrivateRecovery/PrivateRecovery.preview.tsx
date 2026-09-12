import { useState } from 'react';
import { definePreview } from '@tobirink/ui/preview-contract';
import { PrivateRecovery } from './index';
import type { PrivateRecoveryState } from '../../../runtime/use-private-recovery';

function Demo({ initial }: { initial: PrivateRecoveryState }) {
  const [state, setState] = useState(initial);
  return <PrivateRecovery onExport={() => setState('exported')} onRestore={() => setState('restored')} state={state} />;
}

export default definePreview({
  accessibility: ['Champs étiquetés', 'Statut annoncé poliment', 'Confirmation explicite avant remplacement'],
  category: 'Surfaces', dependencies: ['Button', 'Surface'], fixtures: ['Archive et phrase secrète synthétiques'], id: 'extension-private-recovery', level: 'surface', presentation: 'page',
  purpose: 'Exporter et restaurer localement un état privé chiffré.',
  render: ({ state }) => <Demo initial={state === 'error' ? 'error' : 'idle'} />,
  sources: [{ label: 'API publique', path: 'entrypoints/options/PrivateRecovery/index.ts' }, { label: 'Surface', path: 'entrypoints/options/PrivateRecovery/PrivateRecovery.tsx' }, { label: 'Styles', path: 'entrypoints/options/PrivateRecovery/PrivateRecovery.module.css' }],
  states: ['idle', 'error'], title: 'Sauvegarde privée', usage: "import { PrivateRecovery } from './PrivateRecovery';", variants: ['default'],
});
