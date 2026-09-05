export const searchFieldVariants = ['default'] as const;
export const searchFieldStates = ['empty', 'filled', 'focus', 'disabled'] as const;

export type SearchFieldVariant = (typeof searchFieldVariants)[number];
export type SearchFieldState = (typeof searchFieldStates)[number];
