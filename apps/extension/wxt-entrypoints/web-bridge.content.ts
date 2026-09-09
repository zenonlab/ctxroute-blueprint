import { defineContentScript } from 'wxt/utils/define-content-script';
import { z } from 'zod';
import { assertWebBridgeMessageSize, webHandshakeSchema, webRequestEnvelopeSchema } from '@tobirink/contracts/web-bridge';

const siteOrigin = import.meta.env.WXT_PUBLIC_SITE_ORIGIN?.trim() || 'https://tobirink.com';
const pageBridgeMessageSchema = z.union([webHandshakeSchema, webRequestEnvelopeSchema]);

export default defineContentScript({
  registration: siteOrigin ? 'manifest' : 'runtime',
  matches: siteOrigin ? [`${siteOrigin}/*`] : [],
  runAt: 'document_start',
  main() {
    window.addEventListener('message', async (event) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      try { assertWebBridgeMessageSize(JSON.stringify(event.data)); } catch { return; }
      const parsed = pageBridgeMessageSchema.safeParse(event.data);
      if (!parsed.success) return;
      const value = parsed.data;
      const handshake = webHandshakeSchema.safeParse(value);
      const response = handshake.success
        ? await browser.runtime.sendMessage({ handshake: handshake.data, type: 'webbridge.handshake' })
        : await browser.runtime.sendMessage({ envelope: webRequestEnvelopeSchema.parse(value), type: 'webbridge.request' });
      const requestId = handshake.success ? handshake.data.requestId : webRequestEnvelopeSchema.parse(value).request.requestId;
      const pageResponse = { requestId, response, type: 'tobirink.webbridge.response' };
      try { assertWebBridgeMessageSize(JSON.stringify(pageResponse)); } catch { return; }
      window.postMessage(pageResponse, window.location.origin);
    });
  },
});
