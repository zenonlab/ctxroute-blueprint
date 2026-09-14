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

The reusable API keeps gateway and resolver ports injectable. The included
CLI composes the five HTTP adapters and uses short-lived GitHub OIDC tokens to
claim and publish D1 work. Resolver failures remain pending; only terminal
`VERIFIED`, `NOT_FOUND`, and `AMBIGUOUS` results are published.

## Local verification

```sh
npm ci
npm run verify
```

## Public repository extraction

From the private TobiRink repository, the package is an independently valid
repository root and can be split without copying unrelated history:

```sh
git subtree split --prefix=packages/public-discovery -b export/public-discovery
```

The workflow runs only on a daily schedule or manual dispatch. It never runs
for pull requests and receives only `contents: read` plus `id-token: write`.
Its API base URL is the existing Worker's `workers.dev` endpoint so Cloudflare
Bot Fight Mode on the public website cannot challenge the GitHub runner. Both
write routes still require an audience-specific GitHub OIDC token bound to the
exact public repository, `main` branch and workflow file.

`agenda.yml` performs the weekly AniList and MangaUpdates calendar refresh on
the same standard public runner. It publishes only bounded public release
events to the existing Worker through the audience-specific `workers.dev`
route. Cloudflare and the extension serve D1; neither calls an Agenda provider
on the shared path. No title, favorite, URL, account or `.env` enters this flow.
