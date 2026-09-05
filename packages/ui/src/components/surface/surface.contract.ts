export const surfaceVariants = ['plain', 'raised', 'outlined'] as const;
export const surfaceStates = ['default', 'interactive', 'disabled'] as const;

export type SurfaceVariant = (typeof surfaceVariants)[number];
export type SurfaceState = (typeof surfaceStates)[number];
