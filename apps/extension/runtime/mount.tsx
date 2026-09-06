import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@tobirink/ui/tokens.css';
import { ExtensionSurface } from './ExtensionSurface';
import type { ExtensionSurfaceName } from './ExtensionSurface';
import { sendExtensionMessage } from './messages';
import './runtime.css';

function installInternalNavigation() {
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
    const route = anchor?.getAttribute('href')?.slice(1);
    const destination = route === 'agenda'
      ? 'agenda'
      : route === 'settings'
        ? 'settings'
        : route === 'library' || route === 'home'
          ? 'library'
          : undefined;
    if (!destination) return;
    event.preventDefault();
    void sendExtensionMessage({ target: destination, type: 'navigation.open', version: 1 });
  });
}

export function mountSurface(name: ExtensionSurfaceName) {
  const root = document.querySelector<HTMLElement>('#root');
  if (!root) throw new Error('Extension root is missing');
  document.body.dataset.surface = name;
  installInternalNavigation();
  createRoot(root).render(
    <StrictMode>
      <ExtensionSurface name={name} />
    </StrictMode>,
  );
}
