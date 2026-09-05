import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TobirinkLogo } from './index';

describe('TobirinkLogo', () => {
  it('renders the official shared asset as a decorative image', () => {
    const markup = renderToStaticMarkup(<TobirinkLogo className="brand" />);

    expect(markup).toContain('src="/icons/tobirink-128.png"');
    expect(markup).toContain('alt=""');
    expect(markup).toContain('class="brand"');
    expect(markup).not.toContain('<svg');
  });
});
