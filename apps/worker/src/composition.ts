import {
  CloudflareCoverImageAdapter,
  D1CollectiveIndexAdapter,
  D1FavoriteCollectiveAdapter,
  D1PublicCatalogueAdapter,
  R2CoverMasterReadAdapter,
  R2PublicReleaseObjectAdapter,
  WebCryptoCollectiveCredentialAdapter,
} from '@tobirink/adapters-cloudflare';
import type {
  CollectiveIndexDependencies,
  FavoriteCollectiveServicePort,
  CoverImageRenderPort,
  CoverMasterReadPort,
  PublicCatalogueReadPort,
  PublicReleaseObjectPort,
} from '@tobirink/application';
import type { CloudPolicy } from './cloud-policy';
import { cloudPolicy } from './cloud-policy';

export interface WorkerServices {
  favoriteCollective: FavoriteCollectiveServicePort;
  catalogue: PublicCatalogueReadPort;
  collective: CollectiveIndexDependencies & { dailyQuota: number };
  coverImages: CoverImageRenderPort;
  coverMasters: CoverMasterReadPort;
  policy: CloudPolicy;
  releases: PublicReleaseObjectPort;
}

export type WorkerRuntime = {
  Bindings: Env;
  Variables: { services: WorkerServices };
};

function dailyQuota(value: string): number {
  if (!/^\d{1,4}$/u.test(value)) throw new Error('invalid-collective-quota');
  const quota = Number.parseInt(value, 10);
  if (quota < 1 || quota > cloudPolicy.collective.maximumDailyQuota) throw new Error('invalid-collective-quota');
  return quota;
}

export function createWorkerServices(bindings: Env): WorkerServices {
  return {
    favoriteCollective: new D1FavoriteCollectiveAdapter(bindings.COLLECTIVE_DB),
    catalogue: new D1PublicCatalogueAdapter(bindings.COLLECTIVE_DB),
    collective: {
      clock: { now: () => new Date().toISOString() },
      credentials: new WebCryptoCollectiveCredentialAdapter(),
      dailyQuota: dailyQuota(bindings.COLLECTIVE_DAILY_QUOTA),
      index: new D1CollectiveIndexAdapter(bindings.COLLECTIVE_DB),
    },
    coverImages: new CloudflareCoverImageAdapter(bindings.COVER_IMAGES),
    coverMasters: new R2CoverMasterReadAdapter(bindings.COVER_BUCKET),
    policy: cloudPolicy,
    releases: new R2PublicReleaseObjectAdapter(bindings.RELEASE_SNAPSHOTS),
  };
}
