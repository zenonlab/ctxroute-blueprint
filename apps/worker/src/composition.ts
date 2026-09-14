import {
  CloudflareCoverImageAdapter,
  D1PublicCatalogueAdapter,
  D1PublicDiscoveryAdapter,
  D1PublicDiscoveryV2Adapter,
  R2CoverMasterReadAdapter,
  R2PublicReleaseObjectAdapter,
} from '@tobirink/adapters-cloudflare';
import type { PublicDiscoveryV2Port } from '@tobirink/adapters-cloudflare';
import type {
  CoverImageRenderPort,
  CoverMasterReadPort,
  PublicCatalogueReadPort,
  PublicDiscoveryPort,
  PublicReleaseObjectPort,
} from '@tobirink/application';
import type { CloudPolicy } from './cloud-policy';
import { cloudPolicy } from './cloud-policy';
import type { PublicReleaseCalendarPort } from './releases/public-release-calendar';
import { D1PublicReleaseCalendarAdapter } from './releases/public-release-calendar';

export interface WorkerServices {
  catalogue: PublicCatalogueReadPort;
  publicDiscovery: PublicDiscoveryPort;
  publicDiscoveryV2: PublicDiscoveryV2Port;
  publicDiscoveryRateLimiter?: RateLimit;
  coverImages: CoverImageRenderPort;
  coverMasters: CoverMasterReadPort;
  policy: CloudPolicy;
  releases: PublicReleaseObjectPort;
  releaseCalendar: PublicReleaseCalendarPort;
}

export type WorkerRuntime = {
  Bindings: Env;
  Variables: { requestId: string; services: WorkerServices };
};

export function createWorkerServices(bindings: Env): WorkerServices {
  return {
    catalogue: new D1PublicCatalogueAdapter(bindings.PUBLIC_DB),
    publicDiscovery: new D1PublicDiscoveryAdapter(bindings.PUBLIC_DB),
    publicDiscoveryV2: new D1PublicDiscoveryV2Adapter(bindings.PUBLIC_DB),
    publicDiscoveryRateLimiter: bindings.PUBLIC_DISCOVERY_RATE_LIMITER,
    coverImages: new CloudflareCoverImageAdapter(bindings.COVER_IMAGES),
    coverMasters: new R2CoverMasterReadAdapter(bindings.COVER_BUCKET),
    policy: cloudPolicy,
    releases: new R2PublicReleaseObjectAdapter(bindings.RELEASE_SNAPSHOTS),
    releaseCalendar: new D1PublicReleaseCalendarAdapter(bindings.PUBLIC_DB),
  };
}
