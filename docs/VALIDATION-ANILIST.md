# Validation AniList — périmètre anime

> Ce document ne valide plus le catalogue de lecture. Voir [ADR 0021](adr/0021-responsabilites-fournisseurs.md) et les waves F0–F4.

## Base

- Une base neuve applique le bootstrap fournisseur courant.
- La politique `catalog_provider_policy` autorise explicitement `anilist` et `mangaupdates`.
- Le reset catalogue exige `RESET-FAVLIB-CATALOG` et ne remet à zéro que les projections fournisseur ; œuvres, favoris, progression et tous les assets image restent inchangés.

## Enrichissement

- Les jobs portent une clé par œuvre, opération et fingerprint.
- La gate PostgreSQL sérialise les appels AniList entre workers.
- Une ambiguïté reste en `review` ; aucun premier candidat n’est forcé.
- Les titres, synonymes, thèmes, identifiants, relations et métadonnées anime sont persistés avec provenance.

## Images et isolation

- Couverture et bannière sont validées séparément puis stockées en WebP dédupliqué.
- Les erreurs d’image restent observables dans PostgreSQL.
- Alice et Bob peuvent partager l’œuvre et l’asset ; un compte sans favori reçoit `404`.
- Une consultation après enrichissement ne contacte que PostgreSQL.

## Exécution

Lancer `pnpm lint`, `pnpm typecheck`, `pnpm test`, le test d’intégration PostgreSQL, Playwright, le build et le smoke test Docker. Tester aussi timeout, `429`, JSON invalide, image refusée, reprise et concurrence de dix imports.
