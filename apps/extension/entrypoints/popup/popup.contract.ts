export const popupVariants = ['page', 'agenda', 'settings'] as const;
export const popupStates = ['ready', 'loading', 'empty', 'error', 'blocked'] as const;

export type PopupVariant = (typeof popupVariants)[number];
export type PopupState = (typeof popupStates)[number];
