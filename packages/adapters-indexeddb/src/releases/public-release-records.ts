import type { PublicReleaseEvent } from '@tobirink/domain';
import type { PublicReleaseGeneration } from '@tobirink/application';

export interface PublicReleaseStagingRecord {
  readonly id: string;
  readonly generation: string;
  readonly event: PublicReleaseEvent;
}

export interface PublicReleaseSyncRecord {
  readonly id: string;
  readonly activeGeneration?: string;
  readonly checkedAt: string;
  readonly etag?: string;
  readonly fallback?: unknown;
  readonly generation: number;
  readonly revision?: string;
  readonly models?: PublicReleaseGeneration['models'];
  readonly modelWindow?: PublicReleaseGeneration['modelWindow'];
  readonly source?: 'fallback' | 'shared';
  readonly window?: { readonly from: string; readonly to: string };
}
