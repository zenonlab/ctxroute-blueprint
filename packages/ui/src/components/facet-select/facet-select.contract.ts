export const facetSelectVariants = ['default'] as const;
export const facetSelectStates = ['closed', 'open', 'included', 'excluded', 'focus', 'disabled'] as const;
export const facetSelectionStates = ['include', 'exclude'] as const;

export type FacetSelectVariant = (typeof facetSelectVariants)[number];
export type FacetSelectState = (typeof facetSelectStates)[number];
export type FacetSelectionState = (typeof facetSelectionStates)[number];

export interface FacetSelection {
  readonly [value: string]: FacetSelectionState;
}

export interface FacetOption {
  count?: number;
  label: string;
  value: string;
}
