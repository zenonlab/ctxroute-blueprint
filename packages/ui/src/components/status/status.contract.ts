export const statusTones = ['neutral', 'accent', 'success', 'warning', 'danger'] as const;
export const statusStates = ['default', 'live'] as const;

export type StatusTone = (typeof statusTones)[number];
export type StatusState = (typeof statusStates)[number];
