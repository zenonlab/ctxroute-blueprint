---
scope:
  - apps/extension/package.json
  - package-lock.json
  - scripts/infra/**
  - docs/release.md
review: on-change
revised: true
---

# ADR-0039 — Version corrective extension archives

- Status: accepted
- Date: 2026-09-11
- Revised: 2026-09-13

## Context

Published browser archives use immutable, versioned URLs. Replacing an archive
under an existing version can leave installed browsers with stale cached code.

## Decision

Every corrective extension build increments the extension package version
(`1.0.1`, `1.0.2` for the initial cover repair, `1.0.3` for resumable cover
repair, `1.0.4` for resolution during sync restoration, then `1.0.5` for
library projection reconstruction, `1.0.6` for rejecting non-media generic
links, `1.0.7` for explicit MangaUpdates hydration fallback, and `1.0.8` for
excluding pre-serialization matches; `1.0.9` fixes cover referrer handling,
unique complete MangaUpdates matching and blocked-queue recovery; `1.0.10`
restores the MangaUpdates Origin transport rule, accepts absent cover URLs
and prevents HTTP 403 from selecting a fallback; `1.0.11` recognizes Comix
title/chapter routes as manga and prevents cached site-rule downgrade;
`1.0.12` restores durable recovery, honest provider pagination, primary linked
identities, complete library projection and bounded Worker cover recovery;
`1.0.13` exposes inventory state and a trusted bounded reconciliation action;
`1.0.14` adds bounded, disableable local diagnostics; `1.0.15` hardens the
first-install continuation, `1.0.16` projects parsed favorites before
hydration, `1.0.17` restores cache-first sync and D1 reconstruction, and
`1.0.18` ships the bounded multi-provider, owner-scoped collective, durable
sync and pinned FavLib differential corrections; `1.0.19` keeps Library
pagination inside the surface, carries Review covers through WebBridge and
persists bounded owner-only ambiguity references in D1).
`1.0.20` accepts a cleaned bookmark title only when a generic route proves a
media release, groups public cache lookups before provider searches, and
certifies automatic first-install convergence with the corrected batch route.
`1.0.21` accélère la publication checkpointée du snapshot synchronisé, certifie
sa reconstruction après perte d’IndexedDB et ajoute l’export/import privé v5
chiffré avec journal de reprise pour l’identité collective.
`1.0.22` relie l'unique segment humain du nom de favori au slug stable,
retire un identifiant numérique de routage seulement avec corroboration de la
sortie URL et du nom, et force le reparsing par `favorite-parser-v4`.
`1.0.23` conserve les formes parenthésées comme alias structurés de découverte
sans les promouvoir seules en preuve d'identité, câble explicitement les
indices OVA et prépublication dans le runner MV3, et invalide les décisions
automatiques antérieures via `favorite-parser-v5`, `favorite-matcher-v4` et
`favorite-provider-search-v3`. Les décisions humaines restent préservées.
`1.0.24` accepte une route numérique courte devant un slug de sortie uniquement
avec corroboration exacte du nom et remet en résolution les anciennes Reviews
automatiques dont l'artefact sémantique a changé, en conservant un reçu complet.
The
version in `apps/extension/package.json` remains the single WXT and archive
version source; the lockfile and release tests follow it. Existing archives are
retained unchanged. Publishing a new archive remains behind the Cloudflare
infrastructure gate.

## Consequences

An update gets a cache-distinct Chrome and Firefox ZIP. A release can be built
and verified locally before the separately approved R2 publication operation.
Une extension installée depuis un store reçoit les mises à jour signées selon
la politique de ce store. Une extension chargée manuellement depuis un dossier
ou une archive ne s’actualise pas depuis les ZIP TobiRink : l’utilisateur doit
charger le nouveau dossier ou la nouvelle archive en conservant son profil, ou
exporter auparavant la sauvegarde privée chiffrée.
