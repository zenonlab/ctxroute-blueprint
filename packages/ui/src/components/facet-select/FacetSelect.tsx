import { useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { Icon } from '../../icons';
import { SearchField } from '../search-field';
import type { FacetOption, FacetSelection, FacetSelectionState } from './facet-select.contract';
import styles from './FacetSelect.module.css';

export interface FacetSelectProps {
  className?: string;
  defaultOpen?: boolean;
  disabled?: boolean;
  label: string;
  onChange: (value: FacetSelection) => void;
  options: readonly FacetOption[];
  value: FacetSelection;
}

const stateLabels: Record<FacetSelectionState, string> = {
  exclude: 'exclu',
  include: 'inclus',
};

export function FacetSelect({
  className,
  defaultOpen = false,
  disabled = false,
  label,
  onChange,
  options,
  value,
}: FacetSelectProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [searchQuery, setSearchQuery] = useState('');
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeCount = Object.keys(value).length;
  const classes = [styles.root, className].filter(Boolean).join(' ');
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase('fr');
  const visibleOptions = normalizedQuery.length === 0
    ? options
    : options.filter((option) => option.label.toLocaleLowerCase('fr').includes(normalizedQuery));

  function optionButtons() {
    return [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-facet-option]') ?? [])];
  }

  function focusOption(position: 'first' | 'last') {
    requestAnimationFrame(() => {
      const buttons = optionButtons();
      buttons[position === 'first' ? 0 : buttons.length - 1]?.focus();
    });
  }

  function closeMenu() {
    setOpen(false);
    setSearchQuery('');
  }

  function closeAndRestoreFocus() {
    closeMenu();
    triggerRef.current?.focus();
  }

  function handleRootBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;

    requestAnimationFrame(() => {
      if (!rootRef.current?.contains(document.activeElement)) closeMenu();
    });
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      focusOption(event.key === 'ArrowDown' ? 'first' : 'last');
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }

    if (event.target instanceof HTMLInputElement) return;

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    const buttons = optionButtons();
    if (buttons.length === 0) return;

    const currentIndex = buttons.findIndex((button) => button === document.activeElement);
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (currentIndex + direction + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  }

  function toggleOption(optionValue: string) {
    const current = value[optionValue];
    const next = { ...value };

    if (current === undefined) next[optionValue] = 'include';
    else if (current === 'include') next[optionValue] = 'exclude';
    else delete next[optionValue];

    onChange(next);
  }

  return (
    <div className={classes} data-disabled={disabled || undefined} data-open={open || undefined} onBlur={handleRootBlur} ref={rootRef}>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="true"
        className={styles.trigger}
        disabled={disabled}
        onClick={() => {
          if (open) closeMenu();
          else setOpen(true);
        }}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        type="button"
      >
        <span>{label}</span>
        {activeCount > 0 ? <span className={styles.activeCount}>{activeCount}</span> : null}
        <Icon className={styles.chevron} name="chevron-down" size="sm" />
      </button>

      {open ? (
        <div aria-label={`${label} — filtres`} className={styles.menu} id={menuId} onKeyDown={handleMenuKeyDown} role="group">
          <SearchField
            autoComplete="off"
            autoFocus
            className={styles.search}
            label={`Rechercher dans ${label}`}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            placeholder="Rechercher…"
            value={searchQuery}
          />

          {visibleOptions.map((option) => {
            const state = value[option.value];
            const stateLabel = state ? stateLabels[state] : 'neutre';
            const icon = state === 'include' ? 'check' : state === 'exclude' ? 'x' : 'circle';

            return (
              <button
                aria-label={`${option.label} : ${stateLabel}`}
                aria-pressed={state !== undefined}
                className={styles.option}
                data-facet-option
                data-selection={state ?? 'neutral'}
                key={option.value}
                onClick={() => toggleOption(option.value)}
                type="button"
              >
                <span className={styles.stateIcon} data-selection={state ?? 'neutral'}>
                  <Icon name={icon} size="sm" />
                </span>
                <span className={styles.optionLabel}>{option.label}</span>
                {option.count === undefined ? null : <span className={styles.count}>{option.count}</span>}
              </button>
            );
          })}

          {visibleOptions.length === 0 ? <p className={styles.empty} role="status">Aucun résultat</p> : null}
        </div>
      ) : null}
    </div>
  );
}
