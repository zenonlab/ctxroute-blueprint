import type { ComponentPropsWithoutRef } from 'react';

export interface TobirinkLogoProps extends Omit<ComponentPropsWithoutRef<'img'>, 'alt' | 'src'> {}

export function TobirinkLogo(props: TobirinkLogoProps) {
  return <img {...props} alt="" src="/icons/tobirink-128.png" />;
}
