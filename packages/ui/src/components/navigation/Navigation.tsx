import type { KeyboardEvent } from 'react';
import { Icon } from '../../icons';
import type { IconName } from '../../icons';
import type { NavigationVariant } from './navigation.contract';
import styles from './Navigation.module.css';

interface NavigationItemBase {
  icon?: IconName;
  id: string;
  label: string;
}

export interface NavigationLinkItem extends NavigationItemBase {
  href: string;
}

export interface NavigationTabItem extends NavigationItemBase {
  controlsId?: string;
  tabId?: string;
}

interface NavigationBaseProps {
  activeId: string;
  label: string;
}

interface LinkNavigationProps extends NavigationBaseProps {
  items: readonly NavigationLinkItem[];
  kind?: 'links';
  onActiveChange?: never;
  variant?: Exclude<NavigationVariant, 'tabs'>;
}

interface TabNavigationProps extends NavigationBaseProps {
  items: readonly NavigationTabItem[];
  kind: 'tabs';
  onActiveChange: (id: string) => void;
  variant: Extract<NavigationVariant, 'compact' | 'tabs'>;
}

export type NavigationProps = LinkNavigationProps | TabNavigationProps;

function ItemContent({ icon, label }: NavigationItemBase) {
  return (
    <>
      {icon ? <Icon aria-hidden="true" name={icon} size="sm" /> : null}
      <span className={styles.label}>{label}</span>
    </>
  );
}

export function Navigation(props: NavigationProps) {
  const variant = props.variant ?? 'primary';
  const isTabNavigation = props.kind === 'tabs';

  const moveTabFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (!isTabNavigation || !(event.target instanceof HTMLButtonElement)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const currentIndex = tabs.indexOf(event.target);
    if (currentIndex < 0) return;

    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    tabs[nextIndex]?.focus();
  };

  const items = isTabNavigation
    ? (() => {
      const onActiveChange = props.onActiveChange;
      return props.items.map((item) => {
        const active = item.id === props.activeId;
        return (
          <button
            aria-controls={item.controlsId}
            aria-selected={active}
            className={styles.item}
            data-active={active || undefined}
            id={item.tabId}
            key={item.id}
            onClick={() => onActiveChange(item.id)}
            role="tab"
            tabIndex={active ? 0 : -1}
            type="button"
          >
            <ItemContent icon={item.icon} id={item.id} label={item.label} />
          </button>
        );
      });
    })()
    : props.items.map((item) => {
      const active = item.id === props.activeId;
      return (
        <a
          aria-current={active ? 'page' : undefined}
          className={styles.item}
          data-active={active || undefined}
          href={item.href}
          key={item.id}
        >
          <ItemContent {...item} />
        </a>
      );
    });

  return (
    <nav
      aria-label={props.label}
      className={`${styles.navigation} ${styles[variant]}`}
      onKeyDown={moveTabFocus}
      role={isTabNavigation ? 'tablist' : undefined}
    >
      {items}
    </nav>
  );
}
