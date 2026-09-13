---
scope:
  - packages/application/src/library/library-catalogue-contract.ts
  - packages/application/src/library/read-library-catalogue.ts
  - packages/application/src/library/project-pending-favorites.ts
  - packages/contracts/src/web-bridge.ts
  - apps/extension/runtime/library-catalogue-messages.ts
  - apps/extension/runtime/local-library-catalogue-runtime.ts
  - apps/extension/runtime/web-bridge-adapter.ts
  - apps/extension/wxt-entrypoints/background.ts
  - apps/extension/runtime/ExtensionSurface.tsx
  - apps/web/app/library/page.tsx
  - apps/extension/scripts/installed-review.mjs
  - apps/extension/package.json
  - package-lock.json
  - docs/systems/favorite-resolution-rebuild-pipeline.md
  - docs/architecture/src/favorite-resolution.dataflow.json
review: on-change
revised: true
---

# ADR-0042 — Projection locale avant hydratation fournisseur

- Status: accepted
- Date: 2026-09-12
- Revised: 2026-09-13

## Context

L’inventaire conservait immédiatement les sources et leurs artefacts parsés,
mais le catalogue ne lisait que les `Work` résolus. Une indisponibilité ou une
limite fournisseur rendait donc les favoris titrés invisibles. Les œuvres anime
déjà hydratées apparaissaient seules pendant que les mangas attendaient
MangaUpdates, ce qui donnait une vue fausse de la bibliothèque locale.

FavLib projetait chaque favori depuis son état local, puis enrichissait cette
entrée après résolution. Cette propriété utile doit être rétablie sans restaurer
ses anciennes écritures serveur ni créer une Review pendant l’import.

## Decision

Le catalogue fusionne deux projections en lecture seule : les `Work` résolus de
la bibliothèque et les `FavoriteSource` observées dont l’artefact possède une
identité parsée mais pas encore de `Work` résolu. La même lecture choisit la
source observée stable de chaque `Work`, ce qui conserve l’ordre des favoris sans
requête N+1. Une entrée provisoire conserve
un identifiant déterministe dérivé de la source, le titre local, le type parsé,
la position du favori et un état `preparation`, `retryable` ou `review`.

Une source détachée, explicitement `UNSUPPORTED`, sans identité parsée ni
référence fournisseur exacte, ou sans titre exploitable ne rejoint pas le
catalogue. Une référence exacte peut employer le titre local pendant son
hydratation sans inventer d’identité. Le type `UNKNOWN` reste explicite
dans la projection et ne devient ni anime ni manga par défaut. Quand une source
devient `RESOLVED` et que son `Work` existe, sa projection provisoire disparaît
de la même lecture; les sources convergeant vers la même identité partagent le
seul `Work` autoritaire.

La projection provisoire n’est jamais persistée comme `Work`. Elle ne possède
ni identifiant fournisseur inventé, ni métadonnée distante, ni jaquette. Son URL
locale peut servir de destination à la carte dans les contextes de confiance déjà
autorisés. Les tris et facettes utilisent le corpus fusionné, avec `Locale` comme
source et `Inconnu` comme type tant que la résolution ne fournit pas davantage.

Le bootstrap WebBridge lit la bibliothèque autoritaire et un compteur de
projection calculé exclusivement par les index de présence et résolution, sans
scanner les motifs de reprise ni construire, trier ou sérialiser le catalogue complet.
Le nombre projeté additionne les `Work` de la bibliothèque aux sources observées
encore en préparation, Review ou reprise; les invariants de stockage garantissent
qu’une résolution `RESOLVED` référence un `Work` existant. La lecture détaillée
conserve le corpus complet nécessaire aux facettes et au tri. Elle charge les
`Work` avec `bulkGet`, les progressions avec `anyOf(workIds)` et les artefacts
avec `bulkGet`, par lots de cent identifiants au maximum.

Au démarrage normal du navigateur, le runner réutilise un checkpoint d’inventaire
complet et reprend uniquement les travaux dus, sans lancer la réparation globale
de projection. L’installation, la restauration, une demande humaine et l’audit
périodique de six heures gardent le droit de
forcer un inventaire et de réparer la projection; les événements de favoris
traitent immédiatement chaque création, modification, déplacement ou suppression.

## Consequences

La bibliothèque reflète l’inventaire parsé avant toute réponse réseau. Une panne
AniList, MangaUpdates, MangaDex, Kitsu ou du collectif ne cache plus les titres.
La pagination continue de lire IndexedDB par lots bornés et ne crée aucun nouvel
objet persistant. Le contrat de présentation expose l’état et le type inconnu;
le site et l’extension les affichent sans les faire passer pour un fournisseur.
Le réveil MV3 ne crée plus de contention IndexedDB par rescan systématique et le
premier handshake ne paie plus le coût des facettes de toute la bibliothèque.
Le contrat groupé conserve l'ordre des `Work`, représente explicitement une
entrée absente et refuse tout lot vide ou supérieur à cent identifiants.
