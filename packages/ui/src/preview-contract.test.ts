import { describe, expect, it } from 'vitest';
import { definePreview } from './preview-contract';

describe('definePreview', () => {
  it('preserves the preview as the single catalogue source', () => {
    const preview = definePreview({
      id: 'button',
      title: 'Button',
      category: 'Primitives',
      level: 'primitive',
      purpose: 'Déclencher une action.',
      variants: ['primary'],
      states: ['default'],
      fixtures: [],
      sources: [{ label: 'Composant', path: 'Button.tsx' }],
      dependencies: [],
      accessibility: ['Nom accessible'],
      usage: '<Button>Ajouter</Button>',
      render: () => null,
    });

    expect(preview.id).toBe('button');
    expect(preview.variants).toEqual(['primary']);
  });
});
