export const feedbackStateVariants = ['loading', 'empty', 'error'] as const;
export const feedbackStateStates = ['default', 'recoverable'] as const;
export const feedbackStateLayouts = ['inline', 'centered'] as const;

export type FeedbackStateVariant = (typeof feedbackStateVariants)[number];
export type FeedbackStateState = (typeof feedbackStateStates)[number];
export type FeedbackStateLayout = (typeof feedbackStateLayouts)[number];
