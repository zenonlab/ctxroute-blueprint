export const libraryVariants = ['library'] as const;
export const libraryStates = ['ready', 'loading', 'empty', 'review', 'partial', 'offline', 'error', 'blocked'] as const;

export type LibraryVariant = (typeof libraryVariants)[number];
export type LibraryState = (typeof libraryStates)[number];

export interface LibraryWork {
  coverAlt?: string;
  coverSrc?: string;
  href?: string;
  id: string;
  mediaType: string;
  progress?: string;
  source: string;
  title: string;
}
