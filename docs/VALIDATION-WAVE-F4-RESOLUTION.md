# Validation Wave F4 — résolution automatique déterministe

## Portée

- restaure le fallback scoré MangaUpdates sans sélection par rang ;
- accepte uniquement les OEL prouvés graphiques et rejette tous les romans ;
- rapproche les suffixes de saison arabes/romains de manière bornée ;
- corrige les paramètres PostgreSQL ambigus du chemin review ;
- réconcilie uniquement les reviews automatiques sans décision ;
- arrête la ré-enqueue silencieuse des états `TERMINAL` courants ;
- fournit une reprise prévisualisée, dédupliquée et limitée à trois tentatives.

## État de référence capturé

Le 2026-08-06 avant mutation : 13 reviews, dont 11 `PENDING` et 2 `RESOLVED`; trois `MANUAL_REVIEW`; deux décisions existantes; aucun candidat sélectionné; snapshots et candidats présents. Aucun `22P02`; 26 jobs historiques portent le message PostgreSQL `could not determine data type of parameter`, correspondant à `42P08`.

## Gates automatiques

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
git diff --check
```

L'intégration PostgreSQL doit en plus exécuter les branches review avec JSON, tableaux et valeurs nulles, puis confirmer l'absence de `22P02`/`42P08`.

## Checklist manuelle avant application

- [ ] sauvegarde vérifiée et restaurable disponible ;
- [ ] prévisualisation `corepack pnpm resync:pending-reviews` archivée hors Git si elle contient des favoris réels ;
- [ ] `decisionsPreserved=true` ;
- [ ] `legacyManualReviewsRequeued=3` ;
- [ ] les jobs sont dédupliqués sur `(provider, media_id)` ;
- [ ] versions déployées : `anilist-v8`, `mangaupdates-v6` ;
- [ ] aucun job en double pour un même `(provider, media_id)`.

## Checklist après application

- [ ] décisions existantes byte-for-byte inchangées ;
- [ ] les anciens `MANUAL_REVIEW` sont reparsés et leur liste de candidats est remplacée par le résultat fournisseur courant ;
- [ ] les exacts OEL graphiques sont résolus, les Novel restent rejetés ;
- [ ] les reviews partageant un média sont toutes réconciliées si elles sont automatiques ;
- [ ] aucune nouvelle erreur `22P02`/`42P08` ;
- [ ] aucun état terminal courant ré-enqueueé sans invalidation ;
- [ ] nombres de `candidate_snapshot` et `favorite_review_candidate` non diminués.

## Limites connues

Une traduction sémantiquement proche sans exact, forte couverture tokenisée ou variante bornée reste manuelle. La wave ne généralise pas le stemming, ne déduit pas un type graphique depuis une image et ne sélectionne pas un candidat parce qu'il est premier.

## Retour arrière

Arrêter la resynchronisation et redéployer le worker précédent. Ne pas restaurer une base antérieure par-dessus les décisions courantes. Conserver reviews, snapshots, candidats et décisions techniques pour audit.

## Validation

Cette fiche enregistre les preuves techniques mais ne marque pas la wave validée. Le tag reste interdit jusqu'à validation utilisateur explicite.
