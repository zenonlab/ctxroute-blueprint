import type { HTMLAttributes } from 'react';
import type { StatusTone } from './status.contract';
import styles from './Status.module.css';

export interface StatusProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'aria-live' | 'children' | 'role'> {
  children: string | number;
  live?: 'off' | 'polite' | 'assertive';
  tone?: StatusTone;
}

export function Status({ children, className, live = 'off', tone = 'neutral', ...props }: StatusProps) {
  const classes = [styles.status, styles[tone], className].filter(Boolean).join(' ');
  const announces = live !== 'off';

  return (
    <span
      {...props}
      aria-live={announces ? live : undefined}
      className={classes}
      role={announces ? (live === 'assertive' ? 'alert' : 'status') : undefined}
    >
      <span aria-hidden="true" className={styles.dot} />
      <span>{children}</span>
    </span>
  );
}
