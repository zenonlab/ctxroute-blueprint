import { useId } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import styles from './Switch.module.css';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-busy' | 'aria-checked' | 'aria-describedby' | 'aria-labelledby' | 'children' | 'onChange' | 'role'> {
  busy?: boolean;
  checked: boolean;
  description?: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

export function Switch({
  busy = false,
  checked,
  className,
  description,
  disabled,
  id,
  label,
  onCheckedChange,
  type = 'button',
  ...props
}: SwitchProps) {
  const generatedId = useId();
  const switchId = id ?? generatedId;
  const labelId = `${switchId}-label`;
  const descriptionId = `${switchId}-description`;
  const classes = [styles.root, busy ? styles.busy : undefined, className].filter(Boolean).join(' ');

  return (
    <button
      {...props}
      aria-busy={busy || undefined}
      aria-checked={checked}
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={labelId}
      className={classes}
      disabled={disabled || busy}
      id={switchId}
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type={type}
    >
      <span className={styles.copy}>
        <span className={styles.label} id={labelId}>{label}</span>
        {description ? <span className={styles.description} id={descriptionId}>{description}</span> : null}
      </span>

      <span aria-hidden="true" className={styles.track}>
        <span className={styles.thumb} />
      </span>
    </button>
  );
}
