import {
  CloudflareCoverImageAdapter,
  D1PublicCatalogueAdapter,
  D1PublicDiscoveryV3Adapter,
  R2CoverMasterReadAdapter,
  R2PublicReleaseObjectAdapter,
} from '@tobirink/adapters-cloudflare';
import type { PublicDiscoveryV3Port } from '@tobirink/adapters-cloudflare';
import type {
  CoverImageRenderPort,
  CoverMasterReadPort,
  PublicCatalogueReadPort,
  PublicReleaseObjectPort,
} from '@tobirink/application';
import type { CloudPolicy } from './cloud-policy';
import { cloudPolicy } from './cloud-policy';
import type { PublicReleaseCalendarPort } from './releases/public-release-calendar';
import { D1PublicReleaseCalendarAdapter } from './releases/public-release-calendar';
import type { NativeCollectorBindings, NativeCollectorSignal } from './native-collectors';

export interface WorkerServices {
  catalogue: PublicCatalogueReadPort;
  publicDiscoveryV3: PublicDiscoveryV3Port;
  publicDiscoveryRateLimiter?: RateLimit;
  publicDiscoveryQueue?: Queue<NativeCollectorSignal>;
  coverImages: CoverImageRenderPort;
  coverMasters: CoverMasterReadPort;
  policy: CloudPolicy;
  releases: PublicReleaseObjectPort;
  releaseCalendar: PublicReleaseCalendarPort;
}

export type WorkerRuntime = {
  Bindings: NativeCollectorBindings;
  Variables: { requestId: string; services: WorkerServices };
};

export function createWorkerServices(bindings: NativeCollectorBindings): WorkerServices {
  return {
    catalogue: new D1PublicCatalogueAdapter(bindings.PUBLIC_DB),
    publicDiscoveryV3: new D1PublicDiscoveryV3Adapter(bindings.PUBLIC_DB),
    publicDiscoveryRateLimiter: bindings.PUBLIC_DISCOVERY_RATE_LIMITER,
    publicDiscoveryQueue: bindings.PUBLIC_DISCOVERY_QUEUE,
    coverImages: new CloudflareCoverImageAdapter(bindings.COVER_IMAGES),
    coverMasters: new R2CoverMasterReadAdapter(bindings.COVER_BUCKET),
    policy: cloudPolicy,
    releases: new R2PublicReleaseObjectAdapter(bindings.RELEASE_SNAPSHOTS),
    releaseCalendar: new D1PublicReleaseCalendarAdapter(bindings.PUBLIC_DB),
  };
}
