import type { HTMLAttributes, ReactNode } from 'react';
import { Icon } from '../../icons';
import type { IconName } from '../../icons';
import type { FeedbackStateLayout, FeedbackStateVariant } from './feedback-state.contract';
import styles from './FeedbackState.module.css';

interface FeedbackStateBaseProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  description?: ReactNode;
  icon?: IconName;
  layout?: FeedbackStateLayout;
  title: ReactNode;
}

interface LoadingFeedbackStateProps extends FeedbackStateBaseProps {
  action?: never;
  kind: 'loading';
  recoverable?: never;
}

interface EmptyFeedbackStateProps extends FeedbackStateBaseProps {
  action?: ReactNode;
  kind: 'empty';
  recoverable?: never;
}

interface TerminalErrorFeedbackStateProps extends FeedbackStateBaseProps {
  action?: never;
  kind: 'error';
  recoverable?: false;
}

interface RecoverableErrorFeedbackStateProps extends FeedbackStateBaseProps {
  action: ReactNode;
  kind: 'error';
  recoverable: true;
}

export type FeedbackStateProps =
  | EmptyFeedbackStateProps
  | LoadingFeedbackStateProps
  | RecoverableErrorFeedbackStateProps
  | TerminalErrorFeedbackStateProps;

const iconByKind = {
  empty: 'inbox',
  error: 'circle-alert',
  loading: 'loader-circle',
} as const satisfies Record<FeedbackStateVariant, 'circle-alert' | 'inbox' | 'loader-circle'>;

export function FeedbackState({
  action,
  className,
  description,
  icon,
  kind,
  layout = 'inline',
  recoverable,
  title,
  ...props
}: FeedbackStateProps) {
  const classes = [styles.feedback, styles[kind], styles[layout], className].filter(Boolean).join(' ');
  const showAction = action !== undefined && (kind === 'empty' || recoverable === true);

  return (
    <section
      {...props}
      aria-busy={kind === 'loading' || undefined}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
      className={classes}
      data-kind={kind}
      data-layout={layout}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <span aria-hidden="true" className={styles.icon}>
        <Icon name={icon ?? iconByKind[kind]} size={layout === 'centered' ? 'lg' : 'md'} />
      </span>
      <div className={styles.copy}>
        <h2>{title}</h2>
        {description === undefined ? null : <p>{description}</p>}
        {showAction ? <div className={styles.action}>{action}</div> : null}
      </div>
    </section>
  );
}
