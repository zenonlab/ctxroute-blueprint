import { useState } from 'react';
import { definePreview } from '@tobirink/ui/preview-contract';
import { CollectiveSettings } from './index';
import type { CollectiveSettingsProps } from './index';

function Demo({ state }: { state: string }) {
  const [status, setStatus] = useState<CollectiveSettingsProps['status']>(state === 'enabled' ? 'enabled' : state === 'unavailable' ? 'unavailable' : 'disabled');
  const [invitation, setInvitation] = useState<string>();
  return <CollectiveSettings busy={state === 'busy'} error={state === 'error'} invitation={invitation} onEnable={() => setStatus('enabled')} onPair={() => setInvitation('00000000-0000-4000-8000-000000000000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')} onRedeem={() => setStatus('enabled')} onRevoke={() => setStatus('revoked')} status={status} />;
}
export default definePreview({
  id: 'collective-settings', title: 'Appairage et consentement', category: 'Surfaces', level: 'surface', presentation: 'page',
  purpose: 'Consentir au collectif, appairer une installation et révoquer les accès depuis l’extension.',
  variants: ['default'], states: ['disabled', 'enabled', 'unavailable', 'busy', 'error'], fixtures: ['Invitation synthétique sans accès réseau'],
  dependencies: ['Button', 'Surface'], accessibility: ['Consentement décoché initialement', 'Champs nommés et boutons natifs', 'Erreur annoncée et focus visible'],
  sources: [{ label: 'API publique', path: 'entrypoints/options/CollectiveSettings/index.ts' }, { label: 'Surface', path: 'entrypoints/options/CollectiveSettings/CollectiveSettings.tsx' }, { label: 'Styles', path: 'entrypoints/options/CollectiveSettings/CollectiveSettings.module.css' }],
  usage: "import { CollectiveSettings } from './CollectiveSettings';", render: ({ state }) => <Demo key={state} state={state} />,
});
