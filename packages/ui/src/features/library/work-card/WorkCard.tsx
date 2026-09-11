import { useEffect, useRef, useState } from 'react';
import type { AnchorHTMLAttributes, PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../../../icons';
import type { IconName } from '../../../icons';
import { pointInRect, tiltAt } from './card-motion';
import type { WorkCardState, WorkCardVariant } from './work-card.contract';
import styles from './WorkCard.module.css';

export interface WorkCardProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'href' | 'title'> {
  coverAlt?: string;
  coverSrc?: string;
  context: string;
  detail?: string;
  href?: string;
  indicator?: string;
  reviewActions?: {
    disabled?: boolean;
    onSelect: () => void;
    selectLabel?: string;
    sourceLabel?: string;
  };
  state?: WorkCardState;
  title: string;
  variant?: WorkCardVariant;
}

function canTilt(event: ReactPointerEvent<HTMLElement>) {
  return event.pointerType !== 'touch'
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function WorkCard({
  className,
  coverAlt,
  coverSrc,
  context,
  detail = 'Source inconnue',
  href,
  indicator,
  reviewActions,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
  state = 'default',
  title,
  variant = 'library',
  ...props
}: WorkCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const frameRef = useRef(0);
  const pointRef = useRef<ReturnType<typeof pointInRect> | null>(null);
  const [touchFlipped, setTouchFlipped] = useState(false);
  const [failedCover, setFailedCover] = useState<string>();
  const flippable = variant === 'review' && Boolean(reviewActions);
  const classes = [
    styles.card,
    styles[variant],
    styles[state],
    flippable ? styles.flippable : '',
    touchFlipped ? styles.flipped : '',
    className,
  ].filter(Boolean).join(' ');
  const indicatorLabel = indicator ?? '- / -';
  const fallbackIcon = {
    'active-work': 'file-text',
    agenda: 'calendar-days',
    library: 'library-big',
    review: 'search',
  } satisfies Record<WorkCardVariant, IconName>;

  const resetTilt = () => {
    pointRef.current = null;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    const node = cardRef.current;
    if (!node) return;
    node.classList.remove(styles.tilting);
    node.style.setProperty('--work-card-tilt-x', '0deg');
    node.style.setProperty('--work-card-tilt-y', '0deg');
  };

  const scheduleTilt = (event: ReactPointerEvent<HTMLElement>) => {
    if (!canTilt(event)) return;
    pointRef.current = pointInRect(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    event.currentTarget.classList.add(styles.tilting);
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const node = cardRef.current;
      const point = pointRef.current;
      if (!node || !point) return;
      const tilt = tiltAt(point);
      node.style.setProperty('--work-card-tilt-x', `${tilt.x}deg`);
      node.style.setProperty('--work-card-tilt-y', `${tilt.y}deg`);
      node.style.setProperty('--work-card-glare-x', `${tilt.glareX}%`);
      node.style.setProperty('--work-card-glare-y', `${tilt.glareY}%`);
      node.style.setProperty('--work-card-shadow-x', `${tilt.shadowX}px`);
    });
  };

  useEffect(() => {
    if (!flippable) setTouchFlipped(false);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [flippable]);

  const poster = (
    <span className={styles.poster}>
      <span className={styles.visual}>
        {coverSrc && failedCover !== coverSrc
          ? <img alt={coverAlt ?? `Couverture de ${title}`} decoding="async" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedCover(coverSrc)} src={coverSrc} />
          : (
            <span aria-label={`Couverture indisponible pour ${title}`} className={styles.placeholder} role="img">
              <Icon aria-hidden="true" name={fallbackIcon[variant]} size="lg" />
            </span>
          )}
      </span>
      <span className={styles.topline}>
        <span>{context}</span>
        <strong>{indicatorLabel}</strong>
      </span>
      <span className={styles.copy}>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </span>
  );

  if (variant === 'review' && reviewActions) {
    const accessibleLabel = props['aria-label'] ?? `Actions pour le candidat ${title}`;

    return (
      <div
        aria-label={accessibleLabel}
        className={classes}
        data-state={state}
        data-variant={variant}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setTouchFlipped(false);
        }}
        onPointerEnter={(event) => scheduleTilt(event)}
        onPointerLeave={() => resetTilt()}
        onPointerMove={(event) => scheduleTilt(event)}
        onPointerUp={(event) => {
          if (event.pointerType !== 'touch') return;
          if (!(event.target instanceof Element) || !event.target.closest('a, button')) {
            setTouchFlipped((flipped) => !flipped);
          }
        }}
        ref={(node) => { cardRef.current = node; }}
        role="group"
      >
        <div className={styles.rotor}>
          <div className={`${styles.face} ${styles.front}`}>{poster}</div>
          <div className={`${styles.face} ${styles.back}`}>
            <button
              aria-pressed={state === 'selected'}
              className={styles.reviewAction}
              disabled={reviewActions.disabled}
              onClick={() => {
                setTouchFlipped(false);
                reviewActions.onSelect();
              }}
              type="button"
            >
              <span>{reviewActions.selectLabel ?? 'Sélectionner'}</span>
            </button>
            <a className={styles.reviewAction} href={href} rel="noreferrer" target="_blank">
              <span>{reviewActions.sourceLabel ?? 'Source de l’œuvre'}</span>
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <a
      {...props}
      aria-disabled={props['aria-disabled'] ?? (href ? undefined : true)}
      aria-label={props['aria-label'] ?? (href ? `Ouvrir la source de ${title}` : `Source indisponible pour ${title}`)}
      className={classes}
      data-state={state}
      data-variant={variant}
      href={href}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        if (!event.defaultPrevented) scheduleTilt(event);
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        resetTilt();
      }}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        if (!event.defaultPrevented) scheduleTilt(event);
      }}
      ref={(node) => { cardRef.current = node; }}
    >
      {poster}
    </a>
  );
}
