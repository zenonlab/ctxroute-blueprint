import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function installIncompatibleBridge(page: Page) {
  await page.addInitScript(() => {
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.type !== 'webbridge.handshake') return;
      const response = { expiresAt: Date.now() + 60_000, nonce: 'outdated_session_nonce', ok: true, protocolVersion: 1, requestId: message.requestId, type: 'tobirink.webbridge.response' };
      window.postMessage({ requestId: message.requestId, response, type: 'tobirink.webbridge.response' }, window.location.origin);
    });
  });
}

test('incompatible extension never masquerades as empty private data', async ({ page }) => {
  await installIncompatibleBridge(page);
  for (const route of ['/', '/library', '/agenda']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'Extension incompatible' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Télécharger la version actuelle' })).toBeVisible();
  }
});
