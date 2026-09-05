export const switchVariants = ['default'] as const;
export const switchStates = ['off', 'on', 'focus', 'disabled', 'busy'] as const;

export type SwitchVariant = (typeof switchVariants)[number];
export type SwitchState = (typeof switchStates)[number];
