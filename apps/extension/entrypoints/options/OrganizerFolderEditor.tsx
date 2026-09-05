import { Button, Icon } from '@tobirink/ui';
import type { AvailableSettingsProps, OrganizerFilterOptions, OrganizerFolder } from './organizer.types';
import styles from './Settings.module.css';

function toggle(values: readonly string[], id: string) {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

interface FolderEditorProps {
  depth: number;
  draggedId?: string;
  filterOptions: OrganizerFilterOptions;
  folder: OrganizerFolder;
  index: number;
  isRoot?: boolean;
  onAddFolder: AvailableSettingsProps['onAddFolder'];
  onConditionsChange: AvailableSettingsProps['onConditionsChange'];
  onDragEnd: () => void;
  onDragStart: (id: string) => void;
  onFolderNameChange: AvailableSettingsProps['onFolderNameChange'];
  onMoveFolder: AvailableSettingsProps['onMoveFolder'];
  onRemoveFolder: AvailableSettingsProps['onRemoveFolder'];
  onReorderFolder: AvailableSettingsProps['onReorderFolder'];
  onToggleFilters: (id: string) => void;
  openFilters: ReadonlySet<string>;
  siblingCount: number;
}

function FilterPanel({ filterOptions, folder, onConditionsChange }: Pick<FolderEditorProps, 'filterOptions' | 'folder' | 'onConditionsChange'>) {
  const hasFilters = folder.conditions.types.length > 0
    || folder.conditions.statuses.length > 0
    || folder.conditions.progressStates.length > 0;
  const changeGroup = (group: 'progressStates' | 'statuses' | 'types', id: string) => {
    onConditionsChange(folder.id, { ...folder.conditions, [group]: toggle(folder.conditions[group], id) });
  };

  return (
    <>
      <fieldset>
        <legend>Type <span>Facultatif</span></legend>
        <div className={styles.chips}>
          {filterOptions.types.map((choice) => (
            <button aria-pressed={folder.conditions.types.includes(choice.id)} key={choice.id} onClick={() => changeGroup('types', choice.id)} type="button">{choice.label}</button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Statut de l’œuvre <span>Source éditoriale</span></legend>
        <div className={styles.chips}>
          {filterOptions.statuses.map((choice) => (
            <button aria-pressed={folder.conditions.statuses.includes(choice.id)} key={choice.id} onClick={() => changeGroup('statuses', choice.id)} type="button">{choice.label}</button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Progression personnelle <span>Indépendante du statut</span></legend>
        <div className={styles.chips}>
          {filterOptions.progressStates.map((choice) => {
            const selected = folder.conditions.progressStates.includes(choice.id);
            if (choice.id !== filterOptions.stoppedStateId) {
              return <button aria-pressed={selected} key={choice.id} onClick={() => changeGroup('progressStates', choice.id)} type="button">{choice.label}</button>;
            }
            return (
              <span className={[styles.stoppedChip, selected ? styles.selected : ''].filter(Boolean).join(' ')} key={choice.id}>
                <button aria-pressed={selected} onClick={() => changeGroup('progressStates', choice.id)} type="button">{choice.label}</button>
                <span aria-hidden="true">:</span>
                <label>
                  <span className={styles.srOnly}>Arrêté après le chapitre ou l’épisode</span>
                  <input
                    disabled={!selected}
                    inputMode="numeric"
                    min={1}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      onConditionsChange(folder.id, {
                        ...folder.conditions,
                        stoppedAfter: Number.isInteger(value) && value > 0 ? value : undefined,
                      });
                    }}
                    placeholder="10"
                    type="number"
                    value={folder.conditions.stoppedAfter ?? ''}
                  />
                </label>
              </span>
            );
          })}
        </div>
      </fieldset>
      {hasFilters ? <p className={styles.filterHint}>Les groupes actifs sont combinés par ET.</p> : null}
    </>
  );
}

export function OrganizerFolderEditor(props: FolderEditorProps) {
  const {
    depth, draggedId, filterOptions, folder, index, isRoot = false,
    onAddFolder, onConditionsChange, onDragEnd, onDragStart,
    onFolderNameChange, onMoveFolder, onRemoveFolder, onReorderFolder,
    onToggleFilters, openFilters, siblingCount,
  } = props;
  const filtersOpen = openFilters.has(folder.id);
  const panelId = 'organizer-filters-' + folder.id;
  const selectedCount = folder.conditions.types.length
    + folder.conditions.statuses.length
    + folder.conditions.progressStates.length;
  const addChild = () => {
    const childId = onAddFolder(folder.id);
    if (childId) onToggleFilters(childId);
  };

  return (
    <div
      aria-expanded={folder.children.length > 0 || undefined}
      aria-level={depth + 1}
      className={[styles.node, draggedId === folder.id ? styles.dragging : ''].filter(Boolean).join(' ')}
      data-depth={depth}
      onDragOver={(event) => { if (!isRoot && draggedId && draggedId !== folder.id) event.preventDefault(); }}
      onDrop={(event) => {
        event.preventDefault();
        if (!isRoot && draggedId && draggedId !== folder.id) onReorderFolder(draggedId, folder.id);
        onDragEnd();
      }}
      role="treeitem"
    >
      <div className={[styles.folderRow, isRoot ? styles.rootRow : ''].filter(Boolean).join(' ')}>
        {!isRoot ? (
          <button
            aria-label={'Déplacer ' + folder.name + '. Flèches haut et bas pour changer la priorité.'}
            className={styles.drag}
            draggable
            onDragEnd={onDragEnd}
            onDragStart={() => onDragStart(folder.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' && index > 0) {
                event.preventDefault();
                onMoveFolder(folder.id, 'up');
              }
              if (event.key === 'ArrowDown' && index < siblingCount - 1) {
                event.preventDefault();
                onMoveFolder(folder.id, 'down');
              }
            }}
            type="button"
          >
            <Icon name="grip-vertical" size="sm" />
          </button>
        ) : null}
        <span aria-hidden="true" className={styles.folderIcon}>
          <Icon folderPriority={isRoot ? undefined : index + 1} name={isRoot ? 'folder-tree' : 'folder'} size="md" />
        </span>
        <label className={styles.folderName}>
          <span className={styles.srOnly}>Nom du dossier {folder.name}</span>
          <input onChange={(event) => onFolderNameChange(folder.id, event.target.value)} type="text" value={folder.name} />
        </label>
        <div className={styles.folderActions}>
          <Button aria-label={'Créer un dossier dans ' + folder.name} icon="folder-plus" iconOnly onClick={addChild} />
          <Button
            aria-controls={panelId}
            aria-expanded={filtersOpen}
            aria-label={'Filtres de ' + folder.name + (selectedCount ? ', ' + selectedCount + ' actifs' : '')}
            icon="settings-2"
            iconOnly
            onClick={() => onToggleFilters(folder.id)}
          />
          {!isRoot ? <Button aria-label={'Supprimer ' + folder.name} icon="trash-2" iconOnly onClick={() => onRemoveFolder(folder.id)} variant="danger" /> : null}
        </div>
      </div>

      {filtersOpen ? (
        <section aria-label={'Filtres de ' + folder.name} className={styles.filterPanel} id={panelId}>
          <FilterPanel filterOptions={filterOptions} folder={folder} onConditionsChange={onConditionsChange} />
        </section>
      ) : null}

      {folder.children.length > 0 ? (
        <div className={styles.children} role="group">
          {folder.children.map((child, childIndex) => (
            <OrganizerFolderEditor
              depth={depth + 1}
              draggedId={draggedId}
              filterOptions={filterOptions}
              folder={child}
              index={childIndex}
              key={child.id}
              onAddFolder={onAddFolder}
              onConditionsChange={onConditionsChange}
              onDragEnd={onDragEnd}
              onDragStart={onDragStart}
              onFolderNameChange={onFolderNameChange}
              onMoveFolder={onMoveFolder}
              onRemoveFolder={onRemoveFolder}
              onReorderFolder={onReorderFolder}
              onToggleFilters={onToggleFilters}
              openFilters={openFilters}
              siblingCount={folder.children.length}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
