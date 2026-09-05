export const dialogVariants = ['default', 'alert'] as const;
export const dialogSizes = ['default', 'wide'] as const;
export const dialogStates = ['open', 'busy'] as const;

export type DialogVariant = (typeof dialogVariants)[number];
export type DialogSize = (typeof dialogSizes)[number];
export type DialogState = (typeof dialogStates)[number];
