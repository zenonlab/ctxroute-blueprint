import { useCallback, useEffect, useState } from 'react';
import type { QuickPreferences } from '@tobirink/application';
import type { PopupPreferencesModel } from '../entrypoints/popup/Popup';
import { readQuickPreferencesMessage, writeQuickPreferencesMessage } from './messages';

const presentation = [
  { description: 'Notifier à l’heure des sorties officielles ou confirmées.', id: 'nativeNotifications', label: 'Notifications de sorties' },
  { description: 'Inclure les dates encore estimées dans l’agenda.', id: 'showEstimatedReleases', label: 'Afficher les estimations' },
  { description: 'Afficher les œuvres dont le contenu est réservé aux adultes.', id: 'showAdultContent', label: 'Afficher les contenus adultes' },
] as const;

interface QuickPreferencesController {
  model: PopupPreferencesModel;
  onChange: (id: string, enabled: boolean) => void;
}

export function useQuickPreferences(): QuickPreferencesController {
  const [preferences, setPreferences] = useState<QuickPreferences>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void readQuickPreferencesMessage().then((snapshot) => {
      if (active) setPreferences(snapshot);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, []);

  const onChange = useCallback((id: string, enabled: boolean) => {
    if (!preferences || (id !== 'nativeNotifications' && id !== 'showEstimatedReleases' && id !== 'showAdultContent')) return;
    const next = { ...preferences, [id]: enabled };
    setPreferences(next);
    void writeQuickPreferencesMessage(next).then(setPreferences).catch(() => {
      setPreferences(preferences);
      setFailed(true);
    });
  }, [preferences]);

  if (failed) return { model: { state: 'error' }, onChange };
  if (!preferences) return { model: { state: 'loading' }, onChange };
  return {
    model: {
      items: presentation.map((item) => ({ ...item, enabled: preferences[item.id] })),
      state: 'ready',
    },
    onChange,
  };
}
