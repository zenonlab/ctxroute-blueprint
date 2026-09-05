export const buttonVariants = ['primary', 'secondary', 'danger', 'quiet'] as const;
export const buttonStates = ['default', 'hover', 'focus', 'disabled', 'busy'] as const;

export type ButtonVariant = (typeof buttonVariants)[number];
export type ButtonState = (typeof buttonStates)[number];
export type ButtonIconPosition = 'start' | 'end';
export type ButtonIconVisibility = 'always' | 'interaction';
export type ButtonLabelVisibility = 'always' | 'interaction';
