import type { ComponentPreview } from '@tobirink/ui/preview-contract';
import { plannedCatalogue } from './plan';
import type { CatalogueItem, PreviewModule } from './types';

const previewModules = import.meta.glob<PreviewModule>(
  [
    '../../../../packages/ui/src/**/*.preview.tsx',
    '../../../extension/entrypoints/**/*.preview.tsx',
  ],
  { eager: true },
);

function implementedItem(preview: ComponentPreview): CatalogueItem {
  return {
    accessibility: preview.accessibility,
    category: preview.category,
    dependencies: preview.dependencies,
    id: preview.id,
    level: preview.level,
    presentation: preview.presentation ?? 'component',
    purpose: preview.purpose,
    render: preview.render,
    states: preview.states,
    status: 'implemented',
    title: preview.title,
    usage: preview.usage,
    variants: preview.variants,
  };
}

const discovered = Object.values(previewModules)
  .map((module) => implementedItem(module.default));

const discoveredIds = new Set(discovered.map((item) => item.id));

export const catalogue: readonly CatalogueItem[] = [
  ...plannedCatalogue.filter((item) => !discoveredIds.has(item.id)),
  ...discovered,
].sort((left, right) => left.category.localeCompare(right.category) || left.title.localeCompare(right.title));
