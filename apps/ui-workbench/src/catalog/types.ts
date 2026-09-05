import type { ComponentPreview, PreviewCategory, PreviewLevel, PreviewPresentation, PreviewSelection } from '@tobirink/ui/preview-contract';
import type { ReactNode } from 'react';

export type CatalogueStatus = 'planned' | 'implemented';

export interface CatalogueItem {
  accessibility: readonly string[];
  category: PreviewCategory;
  dependencies: readonly string[];
  id: string;
  level: PreviewLevel;
  purpose: string;
  presentation: PreviewPresentation;
  render?: (selection: PreviewSelection) => ReactNode;
  states: readonly string[];
  status: CatalogueStatus;
  title: string;
  usage: string;
  variants: readonly string[];
}

export interface PreviewModule {
  default: ComponentPreview;
}
