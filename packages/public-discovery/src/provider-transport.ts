import type { FavoriteProviderFetch } from './provider-http';

export interface ProviderTransportPort {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

export function bindProviderTransport(port: ProviderTransportPort): FavoriteProviderFetch {
  return (input, init) => port.fetch(input, init);
}
