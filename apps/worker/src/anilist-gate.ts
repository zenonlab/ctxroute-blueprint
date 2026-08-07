import type { AniListHooks } from "@favlib/metadata";
import { acquireProviderRequest } from "@favlib/database/provider-queue";
import {
  blockProviderUntil,
} from "./enrichment-state.js";

type Query = {
  query: (
    sql: string,
    values?: unknown[],
  ) => Promise<{ rowCount?: number | null }>;
};

export function aniListHooks(db: Query,context:{kind?:string;priority?:number;scopeKey?:string}={}): AniListHooks {
  return {
    beforeRequest: async () => {
      return acquireProviderRequest(db,{provider:'anilist',kind:context.kind??'metadata',priority:context.priority??70,scopeKey:context.scopeKey,spacingMs:2100});
    },
    onRateLimit: (until) => blockProviderUntil(db, "anilist", until),
  };
}
