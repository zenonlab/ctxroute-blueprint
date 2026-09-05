import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from '../../icons';
import type { IconName } from '../../icons';
import type {
  ButtonIconPosition,
  ButtonIconVisibility,
  ButtonLabelVisibility,
  ButtonVariant,
} from './button.contract';
import styles from './Button.module.css';

interface ButtonBaseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-busy' | 'children'> {
  busy?: boolean;
  iconPosition?: ButtonIconPosition;
  iconVisibility?: ButtonIconVisibility;
  variant?: ButtonVariant;
}

interface LabelledButtonProps {
  children: ReactNode;
  icon?: IconName;
  iconOnly?: false;
  labelVisibility?: ButtonLabelVisibility;
}

interface IconOnlyButtonProps {
  'aria-label': string;
  children?: never;
  icon: IconName;
  iconOnly: true;
  labelVisibility?: never;
}

export type ButtonProps = ButtonBaseProps & (LabelledButtonProps | IconOnlyButtonProps);

export function Button({
  busy = false,
  children,
  className,
  disabled,
  icon,
  iconOnly = false,
  iconPosition = 'start',
  iconVisibility = 'interaction',
  labelVisibility = 'always',
  type = 'button',
  variant = 'secondary',
  ...props
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    iconOnly ? styles.iconOnly : undefined,
    busy ? styles.busy : undefined,
    className,
  ].filter(Boolean).join(' ');
  const displayedIcon = busy ? 'loader-circle' : icon;
  const renderedIcon = displayedIcon ? (
    <span
      aria-hidden="true"
      className={`${styles.iconSlot} ${busy ? styles.spinner : ''}`}
      data-position={iconPosition}
      data-visibility={busy || iconOnly || labelVisibility === 'interaction' ? 'always' : iconVisibility}
    >
      <Icon name={displayedIcon} size="sm" />
    </span>
  ) : null;

  return (
    <button
      {...props}
      aria-busy={busy || undefined}
      className={classes}
      data-icon-only={iconOnly || undefined}
      data-label-visibility={iconOnly ? undefined : labelVisibility}
      disabled={disabled || busy}
      type={type}
    >
      {renderedIcon && (iconOnly || iconPosition === 'start') ? renderedIcon : null}
      {iconOnly ? null : (
        <span
          className={styles.labelSlot}
          data-position={iconPosition}
          data-visibility={busy ? 'always' : labelVisibility}
        >
          <span className={styles.label}>{children}</span>
        </span>
      )}
      {renderedIcon && !iconOnly && iconPosition === 'end' ? renderedIcon : null}
    </button>
  );
}
