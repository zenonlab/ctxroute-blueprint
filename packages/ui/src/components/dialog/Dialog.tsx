import { useEffect, useId, useRef } from 'react';
import type { MouseEvent, ReactNode, RefObject } from 'react';
import { Button } from '../button';
import { Icon } from '../../icons';
import type { DialogSize, DialogVariant } from './dialog.contract';
import styles from './Dialog.module.css';

export interface DialogProps {
  actions?: ReactNode;
  busy?: boolean;
  children: ReactNode;
  description?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  size?: DialogSize;
  title: string;
  variant?: DialogVariant;
}

const focusableSelector = [
  '[data-dialog-initial-focus]',
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Dialog({
  actions,
  busy = false,
  children,
  description,
  initialFocusRef,
  onOpenChange,
  open,
  size = 'default',
  title,
  variant = 'default',
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!open) {
      if (dialog.open) dialog.close();
      returnFocusRef.current?.focus({ preventScroll: true });
      return;
    }

    if (!dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      dialog.showModal();
    }

    const frame = requestAnimationFrame(() => {
      const target = initialFocusRef?.current
        ?? dialog.querySelector<HTMLElement>(focusableSelector);
      target?.focus({ preventScroll: true });
    });

    return () => cancelAnimationFrame(frame);
  }, [initialFocusRef, open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const cancel = (event: Event) => {
      event.preventDefault();
      if (!busy) onOpenChange(false);
    };
    const close = () => {
      if (busy && open && !dialog.open) dialog.showModal();
      else if (open) onOpenChange(false);
    };
    dialog.addEventListener('cancel', cancel);
    dialog.addEventListener('close', close);
    return () => {
      dialog.removeEventListener('cancel', cancel);
      dialog.removeEventListener('close', close);
    };
  }, [busy, onOpenChange, open]);

  const requestClose = () => {
    if (!busy) onOpenChange(false);
  };

  const closeFromBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) requestClose();
  };

  return (
    <dialog
      aria-busy={busy || undefined}
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      aria-modal="true"
      className={`${styles.dialog} ${styles[variant]} ${styles[size]}`}
      data-size={size}
      data-variant={variant}
      onClick={closeFromBackdrop}
      ref={dialogRef}
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <div className={styles.heading}>
            {variant === 'alert' ? <Icon aria-hidden="true" name="circle-alert" size="md" /> : null}
            <div>
              <h2 id={titleId}>{title}</h2>
              {description ? <p id={descriptionId}>{description}</p> : null}
            </div>
          </div>
          <Button
            className={styles.close}
            disabled={busy}
            icon="x"
            iconPosition="end"
            labelVisibility="interaction"
            onClick={requestClose}
            variant="quiet"
          >
            Fermer
          </Button>
        </header>
        <div className={styles.body}>{children}</div>
        {actions ? <footer className={styles.actions}>{actions}</footer> : null}
        {busy ? (
          <div aria-live="polite" className={styles.busy} role="status">
            <Icon aria-hidden="true" name="loader-circle" size="md" />
            <span>Enregistrement…</span>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
