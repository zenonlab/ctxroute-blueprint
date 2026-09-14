# Public Discovery

Portable batch orchestration for public catalogue discovery.

The package validates JSON contracts and coordinates injected gateway and
resolver ports. It contains no provider client, HTTP client, environment
access, Cloudflare binding, GitHub API, or TobiRink package dependency.

```ts
import { runPublicDiscoveryBatch } from '@tobirink/public-discovery';

await runPublicDiscoveryBatch({ gateway, resolver, limit: 20, nonce, now });
```

The caller owns transport, authentication, provider routing, retries, and
secret handling. Resolver failures are isolated and remain pending at the
gateway. Only terminal `VERIFIED`, `NOT_FOUND`, and `AMBIGUOUS` results are
published.
