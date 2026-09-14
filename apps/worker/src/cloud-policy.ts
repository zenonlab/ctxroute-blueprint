export const cloudPolicy = Object.freeze({
  catalogue: {
    defaultPageSize: 50,
    maximumPageSize: 100,
    maximumRelatedRows: 32,
  },
  cover: {
    immutableCacheControl: 'public, max-age=31536000, immutable',
    masterPrefix: 'covers/masters/sha256',
    quality: 82,
    variants: {
      'cover-lg': { height: 576, width: 384 },
      'cover-md': { height: 288, width: 192 },
      'cover-sm': { height: 144, width: 96 },
    },
  },
  http: {
    noStore: 'no-store',
    publicReadCacheControl: 'public, max-age=300, stale-while-revalidate=3600',
  },
  releases: {
    currentKey: 'releases/current.json',
    snapshotPrefix: 'releases/snapshots',
  },
});

export type CloudPolicy = typeof cloudPolicy;
