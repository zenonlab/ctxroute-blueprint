import { useState } from 'react';
import { Button, Dialog, FeedbackState, Status, TobirinkLogo } from '@tobirink/ui';
import { OrganizerFolderEditor } from './OrganizerFolderEditor';
import type { OrganizerFolder, SettingsProps, UnavailableSettingsProps } from './organizer.types';
import styles from './Settings.module.css';

function isUnavailable(props: SettingsProps): props is UnavailableSettingsProps {
  return props.state === 'blocked' || props.state === 'error' || props.state === 'loading';
}

function Header({ onRestore }: { onRestore?: () => void }) {
  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <TobirinkLogo className={styles.logo} />
        <div>
          <p>Extension Tobirink</p>
          <h1 id="settings-title">Organiser mes favoris</h1>
        </div>
      </div>
      {onRestore ? <Button icon="rotate-ccw" onClick={onRestore} variant="danger">Restaurer</Button> : null}
    </header>
  );
}

function countFolders(folder: OrganizerFolder): number {
  return folder.children.reduce((total, child) => total + 1 + countFolders(child), 0);
}

export function Settings(props: SettingsProps) {
  const [view, setView] = useState<'config' | 'preview'>('config');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [draggedId, setDraggedId] = useState<string>();
  const [openFilters, setOpenFilters] = useState<ReadonlySet<string>>(() => new Set());
  const variant = props.variant ?? 'organizer';

  if (isUnavailable(props)) {
    return (
      <main aria-labelledby="settings-title" className={styles.settings} data-state={props.state} data-variant={variant} data-view="config">
        <Header />
        {props.state === 'loading' ? <FeedbackState description="Lecture de l’arbre enregistré." kind="loading" layout="centered" title="Ouverture de l’organisateur…" /> : null}
        {props.state === 'error' ? <FeedbackState action={<Button icon="refresh-cw" onClick={props.onRetry}>Réessayer</Button>} description="Les dossiers et favoris restent inchangés." kind="error" layout="centered" recoverable title="Organisateur indisponible" /> : null}
        {props.state === 'blocked' ? <FeedbackState description="L’extension doit fournir l’arbre avant toute modification." icon="folder-tree" kind="error" layout="centered" recoverable={false} title="Organisateur non raccordé" /> : null}
      </main>
    );
  }

  const folderCount = countFolders(props.tree);
  const moveCount = props.previewItems.filter((item) => item.action === 'move').length;
  const toggleFilters = (id: string) => {
    setOpenFilters((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const requestPreview = () => {
    if (props.onRequestPreview() !== false) setView('preview');
  };

  return (
    <main aria-labelledby="settings-title" className={styles.settings} data-state={props.state} data-variant={variant} data-view={view}>
      {view === 'config' ? (
        <section aria-labelledby="settings-title" className={styles.settingsPage}>
          <Header onRestore={() => setConfirmRestore(true)} />
          <div className={styles.body}>
            {props.state === 'partial' ? <Status tone="accent">Aperçu partiel · certaines données manquent</Status> : null}
            {props.state === 'offline' ? <Status tone="warning">Hors ligne · organisation disponible</Status> : null}
            <p className={styles.intro}>Créez vos dossiers dans l’ordre souhaité. Dans chaque niveau, la première règle compatible gagne. Aucun favori ne bouge avant validation de l’aperçu.</p>
            <div aria-label="Arbre des dossiers" className={styles.tree} role="tree">
              <OrganizerFolderEditor
                depth={0}
                draggedId={draggedId}
                filterOptions={props.filterOptions}
                folder={props.tree}
                index={0}
                isRoot
                onAddFolder={props.onAddFolder}
                onConditionsChange={props.onConditionsChange}
                onDragEnd={() => setDraggedId(undefined)}
                onDragStart={setDraggedId}
                onFolderNameChange={props.onFolderNameChange}
                onMoveFolder={props.onMoveFolder}
                onRemoveFolder={props.onRemoveFolder}
                onReorderFolder={props.onReorderFolder}
                onToggleFilters={toggleFilters}
                openFilters={openFilters}
                siblingCount={1}
              />
            </div>
          </div>
          <footer className={styles.footer}>
            <span>{folderCount} dossier{folderCount === 1 ? '' : 's'} configuré{folderCount === 1 ? '' : 's'} · {props.previewFresh ? 'aperçu à jour' : 'aperçu requis'}</span>
            <Button disabled={folderCount === 0 || !props.configurationValid} icon="arrow-right" iconPosition="end" onClick={requestPreview} variant="primary">Vérifier le tri</Button>
          </footer>
        </section>
      ) : (
        <section aria-labelledby="settings-preview-title" className={styles.previewPage}>
          <header className={styles.previewHeader}>
            <Button icon="arrow-left" onClick={() => setView('config')}>Retour</Button>
            <h2 id="settings-preview-title">Aperçu du tri</h2>
            <div className={styles.previewCount}><strong>{moveCount}</strong><span>favori{moveCount === 1 ? '' : 's'} à déplacer</span></div>
          </header>
          <div className={styles.body}>
            {!props.previewFresh ? <Status tone="warning">Aperçu à recalculer</Status> : null}
            {props.previewItems.length === 0 ? <FeedbackState description="Modifiez les règles puis recalculez l’aperçu." icon="inbox" kind="empty" layout="centered" title="Aucun favori à déplacer" /> : (
              <div className={styles.tableScroll}>
                <table>
                  <thead><tr><th>Favori</th><th>Destination</th><th>Action</th></tr></thead>
                  <tbody>
                    {props.previewItems.map((item) => (
                      <tr key={item.id}>
                        <td>{item.title}</td>
                        <td>{item.destination}</td>
                        <td><span className={styles[item.action]}>{item.action === 'move' ? 'Déplacer' : 'Conserver'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <footer className={styles.footer}>
            <Button icon="refresh-cw" onClick={props.onRequestPreview}>Recalculer</Button>
            {props.onApplyPreview ? <Button disabled={!props.previewFresh || moveCount === 0} icon="check" onClick={() => setConfirmApply(true)} variant="primary">Appliquer le tri</Button> : null}
          </footer>
        </section>
      )}

      {props.onRestore ? <Dialog
        actions={<><Button icon="x" onClick={() => setConfirmRestore(false)}>Annuler</Button><Button icon="rotate-ccw" onClick={() => { setConfirmRestore(false); props.onRestore?.(); }} variant="danger">Restaurer</Button></>}
        description="Les dossiers retrouveront leur état précédant la dernière application."
        onOpenChange={setConfirmRestore}
        open={confirmRestore}
        title="Restaurer l’organisation précédente ?"
        variant="alert"
      >
        <p>Les favoris ajoutés depuis seront conservés.</p>
      </Dialog> : null}
      {props.onApplyPreview ? <Dialog
        actions={<><Button icon="x" onClick={() => setConfirmApply(false)}>Annuler</Button><Button icon="check" onClick={() => { setConfirmApply(false); props.onApplyPreview?.(); }} variant="primary">Appliquer</Button></>}
        description={`${moveCount} favori${moveCount === 1 ? '' : 's'} sera${moveCount === 1 ? '' : 'ont'} déplacé${moveCount === 1 ? '' : 's'} selon cet aperçu.`}
        onOpenChange={setConfirmApply}
        open={confirmApply}
        title="Appliquer ce tri ?"
        variant="alert"
      >
        <p>Un snapshot vérifié sera enregistré avant le premier déplacement.</p>
      </Dialog> : null}
    </main>
  );
}
