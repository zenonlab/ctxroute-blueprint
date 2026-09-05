import type { HTMLAttributes, ReactNode } from 'react';
import type { SurfaceState, SurfaceVariant } from './surface.contract';
import styles from './Surface.module.css';

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: 'article' | 'div' | 'section';
  children: ReactNode;
  footer?: ReactNode;
  header?: ReactNode;
  state?: SurfaceState;
  variant?: SurfaceVariant;
}

export function Surface({
  as: Element = 'div',
  children,
  className,
  footer,
  header,
  state = 'default',
  variant = 'plain',
  ...props
}: SurfaceProps) {
  const classes = [styles.surface, styles[variant], styles[state], className].filter(Boolean).join(' ');

  return (
    <Element
      {...props}
      aria-disabled={state === 'disabled' ? true : undefined}
      className={classes}
      data-state={state}
      data-variant={variant}
      inert={state === 'disabled' ? true : undefined}
    >
      {header === undefined ? null : <header className={styles.header}>{header}</header>}
      <div className={styles.content}>{children}</div>
      {footer === undefined ? null : <footer className={styles.footer}>{footer}</footer>}
    </Element>
  );
}
