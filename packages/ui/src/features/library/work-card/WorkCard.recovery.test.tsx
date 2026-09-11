// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { WorkCard } from './WorkCard';

describe('bounded cover recovery', () => {
  it('tries the provider then one R2 URL and preserves failure across refreshes', async () => {
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    const props = { context: 'Manga', title: 'Synthetic', coverSrc: 'https://cdn.mangaupdates.com/cover.jpg', coverFallbackSrc: 'https://tobirink.com/v1/media/provider-covers/mangaupdates/12345/cover-md' };
    try {
      await act(async () => { root.render(createElement(WorkCard, props)); });
      expect(node.querySelector('img')?.src).toBe(props.coverSrc);
      await act(async () => { node.querySelector('img')?.dispatchEvent(new Event('error')); });
      expect(node.querySelector('img')?.src).toBe(props.coverFallbackSrc);
      await act(async () => { node.querySelector('img')?.dispatchEvent(new Event('error')); });
      expect(node.querySelector('img')).toBeNull();
      await act(async () => { root.render(createElement(WorkCard, props)); });
      expect(node.querySelector('img')).toBeNull();
      expect(node.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('indisponible');
      await act(async () => { root.render(createElement(WorkCard, { ...props, coverSrc: 'https://cdn.mangaupdates.com/new.jpg' })); });
      expect(node.querySelector('img')?.src).toContain('/new.jpg');
    } finally { await act(async () => { root.unmount(); }); node.remove(); }
  });
});
