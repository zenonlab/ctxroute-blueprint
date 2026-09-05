import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Icon } from '../../icons';
import styles from './SearchField.module.css';

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  label: string;
}

export function SearchField({ className, disabled, id, label, ...props }: SearchFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const classes = [styles.field, className].filter(Boolean).join(' ');

  return (
    <div className={classes} data-disabled={disabled || undefined}>
      <label className={styles.label} htmlFor={inputId}>{label}</label>
      <Icon className={styles.icon} name="search" size="sm" />
      <input
        {...props}
        className={styles.input}
        disabled={disabled}
        id={inputId}
        type="search"
      />
    </div>
  );
}
