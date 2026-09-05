export const workCardVariants = ['library', 'review', 'agenda', 'active-work'] as const;
export const workCardStates = ['default', 'selected', 'unavailable'] as const;

export type WorkCardVariant = (typeof workCardVariants)[number];
export type WorkCardState = (typeof workCardStates)[number];
