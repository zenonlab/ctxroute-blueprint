export const navigationVariants = ['primary', 'tabs', 'compact'] as const;
export const navigationStates = ['default', 'focus'] as const;

export type NavigationVariant = (typeof navigationVariants)[number];
export type NavigationState = (typeof navigationStates)[number];
