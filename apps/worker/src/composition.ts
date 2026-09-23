import {
  CloudflareCoverImageAdapter,
  D1PublicCatalogueAdapter,
  D1PublicDiscoveryV3Adapter,
  R2AgendaOperationStore,
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
import { instrumentD1, type InstrumentedD1 } from './operational-metrics';

export interface WorkerServices {
  catalogue: PublicCatalogueReadPort;
  publicDiscoveryV3: PublicDiscoveryV3Port;
  publicDiscoveryRateLimiter?: RateLimit;
  publicDiscoveryReadRateLimiter?: RateLimit;
  publicDiscoveryQueue?: Queue<NativeCollectorSignal>;
  coverImages: CoverImageRenderPort;
  coverMasters: CoverMasterReadPort;
  policy: CloudPolicy;
  releases: PublicReleaseObjectPort;
  releaseCalendar: PublicReleaseCalendarPort;
  d1Metrics: Pick<InstrumentedD1, 'snapshot'>;
}

export type WorkerRuntime = {
  Bindings: NativeCollectorBindings;
  Variables: { requestId: string; services: WorkerServices };
};

export function createWorkerServices(bindings: NativeCollectorBindings): WorkerServices {
  const d1 = instrumentD1(bindings.PUBLIC_DB);
  return {
    catalogue: new D1PublicCatalogueAdapter(d1.database),
    publicDiscoveryV3: new D1PublicDiscoveryV3Adapter(d1.database),
    publicDiscoveryRateLimiter: bindings.PUBLIC_DISCOVERY_RATE_LIMITER,
    publicDiscoveryReadRateLimiter: bindings.PUBLIC_DISCOVERY_READ_RATE_LIMITER,
    publicDiscoveryQueue: bindings.PUBLIC_DISCOVERY_QUEUE,
    coverImages: new CloudflareCoverImageAdapter(bindings.COVER_IMAGES),
    coverMasters: new R2CoverMasterReadAdapter(bindings.COVER_BUCKET),
    policy: cloudPolicy,
    releases: new R2PublicReleaseObjectAdapter(bindings.RELEASE_SNAPSHOTS),
    releaseCalendar: new D1PublicReleaseCalendarAdapter(d1.database, new R2AgendaOperationStore(bindings.RELEASE_SNAPSHOTS)),
    d1Metrics: d1,
  };
}
