import type { CollectiveCredentialPort } from '@tobirink/application';

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export class WebCryptoCollectiveCredentialAdapter implements CollectiveCredentialPort {
  async hash(secret: string): Promise<string> {
    return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)));
  }

  issueConsentId(): string {
    return `consent_${crypto.randomUUID()}`;
  }

  issueSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return toBase64Url(bytes);
  }
}
