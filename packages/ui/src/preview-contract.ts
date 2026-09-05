import type { ReactNode } from 'react';

export type PreviewCategory = 'Fondations' | 'Primitives' | 'Métier' | 'Surfaces';
export type PreviewLevel = 'foundation' | 'primitive' | 'domain' | 'surface';
export type PreviewPresentation = 'component' | 'page' | 'popup';

export interface PreviewSelection {
  variant: string;
  state: string;
}

export interface PreviewSource {
  label: string;
  path: string;
}

export interface ComponentPreview {
  id: string;
  title: string;
  category: PreviewCategory;
  level: PreviewLevel;
  purpose: string;
  presentation?: PreviewPresentation;
  variants: readonly string[];
  states: readonly string[];
  fixtures: readonly unknown[];
  sources: readonly PreviewSource[];
  dependencies: readonly string[];
  accessibility: readonly string[];
  usage: string;
  render: (selection: PreviewSelection) => ReactNode;
}

export function definePreview<const TPreview extends ComponentPreview>(preview: TPreview): TPreview {
  return preview;
}
