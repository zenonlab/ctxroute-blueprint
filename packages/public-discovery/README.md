# Public Discovery

Standalone MIT-licensed collectors for the TobiRink public catalogue and Agenda.

The repository validates the D1 request/result protocol and resolves missing
works through five explicit provider identities: AniList, MangaUpdates,
MangaDex, Kitsu Anime and Kitsu Manga. It has no dependency on another
`@tobirink/*` package, Cloudflare binding or long-lived secret.

```ts
import { runPublicDiscoveryBatch } from '@tobirink/public-discovery';

await runPublicDiscoveryBatch({ gateway, resolver, limit: 20, nonce, now });
```

The reusable API keeps gateway and resolver ports injectable. The Cloudflare
Queue consumer in the main repository composes the five HTTP adapters and
publishes directly through the D1 port. Resolver failures remain pending; only terminal
`VERIFIED`, `NOT_FOUND`, and `AMBIGUOUS` results are published.

## Local verification

```sh
npm ci
npm run verify
```

The package remains independently testable, but no longer carries a CLI,
GitHub workflow or external D1 writer. Discovery is signaled immediately and
Agenda runs one weekly, checkpointed Worker collection. Provider traffic
crosses the isolated signed gateway; no title, favorite, URL or account enters
it.
