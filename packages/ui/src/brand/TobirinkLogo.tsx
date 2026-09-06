import type { ComponentPropsWithoutRef } from 'react';

export interface TobirinkLogoProps extends Omit<ComponentPropsWithoutRef<'img'>, 'alt'> {}

export function TobirinkLogo({ src = '/icons/tobirink-128.png', ...props }: TobirinkLogoProps) {
  return <img {...props} alt="" src={src} />;
}
