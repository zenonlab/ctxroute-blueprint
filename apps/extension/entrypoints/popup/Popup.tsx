import { useState } from 'react';
import { Button, FeedbackState, Navigation, Switch, TobirinkLogo, WorkCard } from '@tobirink/ui';
import type { PopupState, PopupVariant } from './popup.contract';
import styles from './Popup.module.css';

export interface PopupWork {
  coverAlt?: string;
  coverSrc?: string;
  href: string;
  indicator?: string;
  mediaType: string;
  source: string;
  title: string;
}

export type PopupPageModel =
  | { state: Extract<PopupState, 'blocked' | 'empty' | 'error' | 'loading'> }
  | { state: Extract<PopupState, 'ready'>; work: PopupWork };

export type PopupAgendaModel =
  | { state: Extract<PopupState, 'blocked' | 'empty' | 'error' | 'loading'> }
  | { items: readonly PopupWork[]; state: Extract<PopupState, 'ready'> };

export type PopupContinuationsModel =
  | { state: Extract<PopupState, 'blocked' | 'error' | 'loading'> }
  | { items: readonly PopupWork[]; state: Extract<PopupState, 'ready'> };

export interface PopupPreference {
  description: string;
  enabled: boolean;
  id: string;
  label: string;
}

export interface PopupConnection {
  label: string;
  tone: 'error' | 'neutral' | 'ready' | 'syncing';
}

export type PopupPreferencesModel =
  | { state: Extract<PopupState, 'blocked' | 'error' | 'loading'> }
  | {
    items: readonly PopupPreference[];
    state: Extract<PopupState, 'ready'>;
  };

export interface PopupProps {
  agenda: PopupAgendaModel;
  connection?: PopupConnection;
  continuations: PopupContinuationsModel;
  initialPanel?: PopupVariant;
  onOpenAgenda: () => void;
  onOpenFullSettings: () => void;
  onPreferenceChange?: (id: string, enabled: boolean) => void;
  onRetryAgenda?: () => void;
  onRetryPage?: () => void;
  page: PopupPageModel;
  preferences: PopupPreferencesModel;
}

const extensionPanels = [
  { controlsId: 'popup-page-panel', icon: 'file-text' as const, id: 'page', label: 'Œuvre', tabId: 'popup-page-tab' },
  { controlsId: 'popup-agenda-panel', icon: 'calendar-days' as const, id: 'agenda', label: 'Sorties', tabId: 'popup-agenda-tab' },
  { controlsId: 'popup-settings-panel', icon: 'settings-2' as const, id: 'settings', label: 'Réglages', tabId: 'popup-settings-tab' },
] satisfies readonly { controlsId: string; icon: 'calendar-days' | 'file-text' | 'settings-2'; id: PopupVariant; label: string; tabId: string }[];

function PanelHeading({ children }: { children: string }) {
  return <h2 className={styles.panelTitle}>{children}</h2>;
}

function Work({ item, onOpen, variant }: { item: PopupWork; onOpen?: () => void; variant: 'active-work' | 'agenda' | 'library' }) {
  return (
    <WorkCard
      aria-label={onOpen ? `Ouvrir Agenda pour ${item.title}` : undefined}
      coverAlt={item.coverAlt}
      coverSrc={item.coverSrc}
      context={item.mediaType}
      detail={item.source}
      href={item.href}
      indicator={item.indicator}
      onClick={onOpen ? (event) => {
        event.preventDefault();
        onOpen();
      } : undefined}
      rel="noreferrer"
      target="_blank"
      title={item.title}
      variant={variant}
    />
  );
}

export function Popup({
  agenda,
  connection,
  continuations,
  initialPanel = 'page',
  onOpenAgenda,
  onOpenFullSettings,
  onPreferenceChange,
  onRetryAgenda,
  onRetryPage,
  page,
  preferences,
}: PopupProps) {
  const [activePanel, setActivePanel] = useState<PopupVariant>(initialPanel);

  return (
    <section aria-label="Tobirink" className={styles.popup}>
      <header className={styles.header}>
        <span className={styles.brand}>
          <TobirinkLogo className={styles.brandLogo} />
          <h1>Tobirink</h1>
        </span>
        {connection ? (
          <span aria-label={connection.label} className={styles.connection} data-tone={connection.tone} role="status" title={connection.label}>
            <span aria-hidden="true" />
          </span>
        ) : null}
      </header>

      <main
        aria-labelledby={extensionPanels.find(({ id }) => id === activePanel)?.tabId}
        className={styles.viewport}
        id={extensionPanels.find(({ id }) => id === activePanel)?.controlsId}
        role="tabpanel"
      >
        {activePanel === 'page' ? (
          <section aria-label="Cette œuvre" className={styles.panel} data-state={page.state}>
            <PanelHeading>Cette œuvre</PanelHeading>
            {page.state === 'ready' ? <div className={styles.primaryCard}><Work item={page.work} variant="active-work" /></div> : null}
            {page.state === 'loading' ? <FeedbackState className={styles.feedback} kind="loading" layout="centered" title="Analyse de la page…" /> : null}
            {page.state === 'empty' ? <FeedbackState className={styles.feedback} description="Ouvrez une page d’œuvre compatible pour la retrouver ici." icon="file-text" kind="empty" layout="centered" title="Aucune œuvre détectée" /> : null}
            {page.state === 'error' && onRetryPage ? <FeedbackState action={<Button icon="refresh-cw" onClick={onRetryPage}>Relire la page</Button>} className={styles.feedback} description="Le contexte de cette page n’a pas pu être lu." kind="error" layout="centered" recoverable title="Analyse interrompue" /> : null}
            {page.state === 'error' && !onRetryPage ? <FeedbackState className={styles.feedback} description="Le contexte de cette page n’a pas pu être lu." kind="error" layout="centered" recoverable={false} title="Analyse interrompue" /> : null}
            {page.state === 'blocked' ? <FeedbackState className={styles.feedback} description="Cette version ne peut pas encore lire le contexte de l’onglet actif." icon="puzzle" kind="error" layout="centered" recoverable={false} title="Analyse indisponible" /> : null}
            <section aria-labelledby="popup-continuations-title" className={styles.continuations}>
              <h3 id="popup-continuations-title">Continuer mes œuvres</h3>
              {continuations.state === 'ready' && continuations.items.length > 0 ? (
                <div className={styles.cardGrid}>
                  {continuations.items.map((item) => <Work item={item} key={`${item.href}-${item.title}`} variant="library" />)}
                </div>
              ) : null}
              {continuations.state === 'ready' && continuations.items.length === 0 ? <p className={styles.continuationEmpty}>Aucune œuvre à reprendre.</p> : null}
              {continuations.state === 'loading' ? <p aria-live="polite" className={styles.continuationEmpty}>Lecture des reprises…</p> : null}
              {continuations.state === 'error' ? <p role="alert" className={styles.continuationEmpty}>Les reprises sont momentanément indisponibles.</p> : null}
              {continuations.state === 'blocked' ? <p className={styles.continuationEmpty}>Les reprises locales ne sont pas accessibles.</p> : null}
            </section>
          </section>
        ) : null}

        {activePanel === 'agenda' ? (
          <section aria-label="Sorties" className={styles.panel} data-state={agenda.state}>
            <PanelHeading>Sorties</PanelHeading>
            {agenda.state === 'ready' && agenda.items.length > 0 ? <div className={styles.cardGrid}>{agenda.items.map((item) => <Work item={item} key={`${item.href}-${item.title}`} onOpen={onOpenAgenda} variant="agenda" />)}</div> : null}
            {agenda.state === 'loading' ? <FeedbackState className={styles.feedback} kind="loading" layout="centered" title="Lecture des sorties…" /> : null}
            {agenda.state === 'error' && onRetryAgenda ? <FeedbackState action={<Button icon="refresh-cw" onClick={onRetryAgenda}>Réessayer</Button>} className={styles.feedback} description="Les données locales restent intactes." kind="error" layout="centered" recoverable title="Agenda indisponible" /> : null}
            {agenda.state === 'error' && !onRetryAgenda ? <FeedbackState className={styles.feedback} description="Les données locales restent intactes." kind="error" layout="centered" recoverable={false} title="Agenda indisponible" /> : null}
            {agenda.state === 'blocked' ? <FeedbackState className={styles.feedback} description="Le menu n’a pas encore accès aux sorties locales." icon="calendar-days" kind="error" layout="centered" recoverable={false} title="Sorties indisponibles" /> : null}
          </section>
        ) : null}

        {activePanel === 'settings' ? (
          <section aria-label="Réglages rapides" className={styles.panel} data-state={preferences.state}>
            <PanelHeading>Réglages rapides</PanelHeading>
            {preferences.state === 'ready' ? (
              <div className={styles.preferences}>
                {preferences.items.map((preference) => (
                  <Switch
                    checked={preference.enabled}
                    description={preference.description}
                    id={preference.id}
                    key={preference.id}
                    label={preference.label}
                    onCheckedChange={(enabled) => onPreferenceChange?.(preference.id, enabled)}
                    disabled={!onPreferenceChange}
                  />
                ))}
              </div>
            ) : null}
            {preferences.state === 'loading' ? <FeedbackState className={styles.feedback} kind="loading" layout="centered" title="Lecture des préférences…" /> : null}
            {preferences.state === 'error' ? <FeedbackState className={styles.feedback} description="Ouvrez les réglages complets pour vérifier la configuration." kind="error" layout="centered" recoverable={false} title="Préférences indisponibles" /> : null}
            {preferences.state === 'blocked' ? <FeedbackState className={styles.feedback} description="Utilisez les réglages complets pour configurer cette version." icon="settings-2" kind="empty" layout="centered" title="Réglages rapides indisponibles" /> : null}
            <Button className={styles.fullSettings} icon="settings-2" onClick={onOpenFullSettings}>Ouvrir les réglages complets</Button>
          </section>
        ) : null}
      </main>

      <Navigation
        activeId={activePanel}
        items={extensionPanels}
        kind="tabs"
        label="Navigation de l’extension"
        onActiveChange={(id) => {
          const panel = extensionPanels.find((item) => item.id === id);
          if (panel) setActivePanel(panel.id);
        }}
        variant="compact"
      />
    </section>
  );
}
