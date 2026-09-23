---
scope:
  - apps/extension/package.json
  - apps/web/published-extension.json
  - apps/web/app/download/page.tsx
  - package-lock.json
  - scripts/infra/**
  - docs/release.md
review: on-change
revised: true
---

# ADR-0039 — Version corrective extension archives

- Status: accepted
- Date: 2026-09-11
- Revised: 2026-09-23

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
`1.0.25` retire le rescan global au démarrage normal, remplace les lectures
IndexedDB unitaires de la bibliothèque par des lots `bulkGet`/`anyOf` bornés à
cent identifiants et calcule le bootstrap avec trois comptes indexés.
`1.0.26` publie la première correction de mutualisation sans prétendre résoudre
la collecte Agenda bloquée depuis Cloudflare. `1.0.27` corrige le receiver du
`fetch` navigateur, déplace la collecte Agenda vers GitHub OIDC et remplace le
Collectif par le cache public vérifié D1-first de l'ADR-0046.
`1.0.28` retire la recherche fournisseur de la découverte automatique MV3 :
l’extension lit ou crée une demande D1 v2, puis consomme la fiche complète
produite par le composant Discovery appelé via GitHub Actions OIDC.
`1.0.29` rend cette frontière exhaustive : la récupération automatique
d'identités et de couvertures ne peut plus réactiver les adaptateurs
fournisseurs lorsque Public Discovery est configuré; le calendrier partagé
utilise `/v3/releases` et vérifie fraîcheur et couverture avant tout repli.
`1.0.30` retire aussi le dernier repli Agenda direct vers AniList et
MangaUpdates. L'extension lit uniquement la génération D1 partagée ou son
dernier cache partagé valide ; toute nouvelle collecte fournisseur appartient
au workflow GitHub public vérifié.
`1.0.31` retire les derniers runtimes et exports fournisseur orphelins, la
règle DNR MangaUpdates et la restauration directe d’identité. Les parcours
automatiques comme manuels passent désormais exclusivement par Public
Discovery v3 et le cache Agenda partagé.
`1.0.33` est restée la version publiée immuable jusqu'à la certification. La
version `1.0.34` est maintenant publiée avec Chrome (294587 octets, SHA-256
`264a48e9e292baeb082474e7ceb6c499f9bc3ba0f9e6e8031951c5a98cf0ac6b`) et
Firefox (294628 octets, SHA-256
`201f633c0a2d02ed60dc9f02e101f74a941a832f66854064f8238841ed24d79d`). Elle
absorbe les
rejets du rafraîchissement Agenda dans le service worker afin qu’une génération
publique invalide ne produise pas de promesse non gérée. Son inférence générique
reconnaît les marqueurs de sortie avec leurs séparateurs courants et ne retire
les identifiants de routage ou les locales que lorsque le slug humain est
corroboré par le titre du favori. En l’absence de corroboration, elle revient au
titre humain avant l’application éventuelle d’une règle de site plus précise.
La candidate corrective suivante est `1.0.36`; elle ne réécrit aucun objet
`1.0.35` et ne peut avancer le pointeur public qu’après publication vérifiée.
`1.0.37` corrige l’extraction comparative, la récupération
locale versionnée et les reprises durables Public Discovery. Ses archives
immuables ont été téléchargées et vérifiées avant de remplacer le pointeur
`1.0.36`; les deux canaries publics ont atteint `VERIFIED` sur le Worker corrigé.
`1.0.38` corrige la famine d’admission dans le budget MV3.
Sa gate installée retarde la prélecture de six secondes et simule seulement
un cache froid; deux demandes publiques réelles au plus par clé contrôlent
l’émission vers le Worker puis l’affichage local vérifié, sans modifier le ZIP.
The version in `apps/extension/package.json` remains the single WXT and archive
candidate source. The static download page follows the separately versioned
`apps/web/published-extension.json` publication pointer, which is advanced only
after both immutable archives have been uploaded and verified. Release tests
must prove that an unpublished candidate cannot move public links.
Existing archives are retained unchanged. A `worker-deploy` preview and apply
must each rebuild the web workspace before invoking Wrangler, so the reviewed
bundle and the deployed Worker cannot reuse a stale `apps/web/out` from an
older extension version. A failed web build prevents Wrangler from running.
The R2 publication adapter reads each exact object through the authenticated
Cloudflare API during plan inspection and immediately before upload. Only an
authenticated 404 means absent. A matching SHA-256 and size produce an
idempotent skip; different bytes, failed authentication, oversized content or
an unavailable API stop before upload. Public HTTP status is never used as
proof of object absence. These checks reuse the deployment token and request
no permission or billing mutation. Wrangler offers no conditional-put flag:
the final read narrows, but does not atomically eliminate, races with an
independent writer; the release workflow must remain single-writer.
Publishing a new archive remains behind the Cloudflare infrastructure gate. The
1.0.34 plan digest was `d272ac3e68ac5b2a2a05f792fbdf95b18ffc5e99fd9fdc22e38ec04c0cdd78df`
for the two R2 objects and `worker:tobirink-public-api`; the deployed Worker
version was `2905a076-d107-4a29-8408-f24f86c97555`.

## Consequences

La candidate locale `1.0.44` corrige le receiver et les clés de reprise,
les continuations MV3 et les scans de projection. `1.0.43` étant déjà publiée,
ses ZIP restent immuables. Le pointeur Web reste `1.0.43` pendant la
certification; aucun résultat local n'atteste une publication R2. Le lockfile
porte la même version candidate que le manifeste extension.

`1.0.39` livre la reprise R2/Queue, les modèles D1 courants et la propagation
locale des corrections, avec ETag par page et invalidation des annonces et
notifications obsolètes. Sa publication et ses limites sont consignées dans
le runbook. La candidate non publiée `1.0.40` corrige les périodes civiles, la
concurrence du cache, les notifications et le repli sur l'historique avant le
premier modèle v4. Le pointeur public est resté en `1.0.39` jusqu'à la
publication séparée des ZIP vérifiés; aucun objet antérieur n'a été remplacé.

`1.0.41` ajoute la reconnexion WebBridge après un redémarrage MV3 et maintient
les tris de la bibliothèque sur les données locales. Ses archives Chrome et
Firefox immuables ont été publiées et relues avec les SHA-256 certifiés avant
l'avancement du pointeur public de `1.0.39` à `1.0.41`. La candidate `1.0.40`
n'a pas été publiée et ses archives locales ne sont pas remplacées.

An update gets a cache-distinct Chrome and Firefox ZIP. A release can be built
and verified locally before the separately approved R2 publication operation.
Une extension installée depuis un store reçoit les mises à jour signées selon
la politique de ce store. Une extension chargée manuellement depuis un dossier
ou une archive ne s’actualise pas depuis les ZIP TobiRink : l’utilisateur doit
charger le nouveau dossier ou la nouvelle archive en conservant son profil, ou
exporter auparavant la sauvegarde privée chiffrée.
