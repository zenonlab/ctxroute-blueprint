# Waves, tests et critères de sortie

## Règle de pilotage

Une seule wave est active à la fois. Une wave est `DONE` uniquement lorsque :

- le code et les migrations sont présents ;
- les tests automatisés de la wave passent ;
- les données et les décisions utilisateur ont été contrôlées ;
- le rollback est documenté et testé au niveau approprié.

Les preuves doivent indiquer la date, le build, la version de schéma, le nombre
de favoris concernés et les causes résiduelles. Un test avec une valeur observée
ne transforme pas cette valeur en donnée canonique.

## F0 — Doctrine, contrats et provenance

**Objectif :** empêcher la confusion entre favori, source et fournisseur.

**Livrables :** `AGENT.md`, ADR fournisseurs, politiques par finalité, schéma des
payloads, provenance champ par champ, codes d’erreur et diagnostic read-only.

**Tests :** contrats Zod, fixtures anonymisées, typecheck, tests de provenance,
vérification qu’un résultat fournisseur ne crée pas de titre `source` ou
`personal`.

**Gate :** toute donnée durable a un propriétaire, une finalité, une source et
une règle de rétention ; aucun secret ou favori réel dans les fixtures.

**Rollback :** désactivation de la nouvelle finalité fournisseur et conservation
des identités locales.

## F1 — Runtime, files et résilience

**Objectif :** rendre les jobs observables et reprenables avant d’augmenter le
volume de recherche.

**Livrables :** leases atomiques, lane par fournisseur, cadence minimale,
backoff, codes d’erreur, heartbeat, healthcheck, jobs idempotents et diagnostic
de queue.

**Tests :** concurrence, retry `429`, timeout, DNS, crash/reprise, job déjà
réalisé, état non dû, isolation Alice/Bob et routes API authentifiées.

**Gate :** aucun job sans consommateur, aucun succès fictif, un backlog synthétique
reste observable et finit par atteindre un état terminal explicite.

**Rollback :** build précédent sans migration destructive ; les jobs nouveaux
doivent être identifiables et annulables.

## F2 — Worker lecture MangaUpdates

**Objectif :** confirmer l’identité des manga, manhwa et manhua avec MangaUpdates,
sans faire dépendre l’identité de lecture d’AniList.

**État actuel :** le connecteur recherche, détaille, filtre les romans/fiches
mortes, classe les séries et persiste les titres associés. Son moteur de
résolution reste toutefois plus permissif que le contrat commun.

**Travail restant obligatoire :**

- limiter les alias entrants à `source`/`personal` ;
- borner variantes, pagination et nombre de fiches détaillées ;
- agréger tous les résultats avant sélection ;
- distinguer exact unique, ambiguïté, type incompatible, faible confiance et absence ;
- conserver les candidats avant toute sélection ;
- tracer le score et le tie-break sans utiliser l’ordre fournisseur comme preuve.

**Tests :** titres associés, translittérations, parenthèses, titres proches,
manga/manhwa/manhua, roman rejeté, fiche morte, `401`, `429`, timeout, réponse
malformée, deux candidats équivalents et résultat dans un ordre différent.

**Gate :** un même jeu de candidats permuté produit la même décision ; aucun
faux rattachement automatique dans les cas ambigus ; type local et type
fournisseur restent compatibles.

## F3 — Worker animé AniList

**Objectif :** résoudre les anime avec AniList et séparer identité, métadonnées
riches et images.

**Livrables réalisés :** alias `source`/`personal`, variantes bornées, recherche
pages 1–2, déduplication par ID, comparaison normalisée/compacte, codes de
résolution, candidates en review, fiche riche différée et snapshot reconstructible.

**Tests :**

- `Isekai Ojisan` contre `Isekai Oji-san` ;
- aucun titre anglais fournisseur injecté comme alias ;
- premier résultat d’un autre type conservé comme candidat ;
- résultats génériques conservés sans sélection ;
- aucun résultat avec `NO_RESULT` ;
- plusieurs exacts avec review ;
- 429 et headers de reset ;
- batch d’IDs, cache et pagination ;
- image incapable de créer ou modifier une identité.

**Gate :** une correspondance compacte unique peut être validée ; un résultat
seulement ressemblant ne le peut pas ; l’ordre des résultats ne change pas la
décision.

## F4 — Review interactive et réparation

**Objectif :** donner à l’utilisateur la décision finale sans modifier son
favori, son titre personnel, sa progression ou une décision déjà prise.

**Livrables :** `favorite_review`, `favorite_review_candidate`, cause visible,
notification dédupliquée, candidats détaillés, sélection manuelle vérifiée,
`NO_MATCH`, migration de réparation depuis `candidate_snapshot`.

**Tests :**

- candidat exact et variante parenthésée séparés ;
- candidats génériques affichés ;
- review vide explicitement expliquée ;
- retry idempotent et notification unique ;
- résolution limitée au favori ciblé ;
- URL ou ID fournisseur non vérifié refusé ;
- Alice ne lit ni ne modifie la review de Bob ;
- migration sans changement de `status`, `selected_candidate_id`, `decision` ou lien favori ;
- contrôle avant/après du nombre total de reviews.

**Gate :** les 13 reviews historiques sont comptées avant et après migration ;
les candidats sont reconstruits quand le snapshot le permet ; aucune œuvre n’est
sélectionnée automatiquement.

## F5 — Unification des workers

**Objectif :** supprimer l’asymétrie de sûreté et de budget entre lecture et
animé.

**Livrables :** moteur partagé pour alias, variantes, pagination, agrégation,
déduplication, score explicable et routage décisionnel ; adaptateurs fournisseur
limités au mapping de payload et au contrôle de type.

**Politique de décision cible :**

| Classe | Condition | Action |
|---|---|---|
| `EXACT_UNIQUE` | une seule clé normalisée/compacte compatible | validation automatique |
| `SCORED_UNIQUE` | score élevé, écart documenté et contrat fournisseur autorisé | validation selon policy |
| `AMBIGUOUS` | plusieurs candidats proches ou ex æquo | review |
| `TYPE_MISMATCH` | résultats d’un type incompatible | review avec candidats |
| `NO_RESULT` | aucun résultat fournisseur | review vide |

Le mode `SCORED_UNIQUE` ne sera activé pour la lecture qu’après une calibration
sur fixtures et un contrôle de faux positifs. Aucun score ne pourra se substituer
à un seuil, à un écart minimal et à un contrôle de type.

**Tests :** mêmes fixtures injectées dans les deux adaptateurs, permutation des
résultats, budgets de requêtes, N+1 détecté, pagination, retries et comparaison
des codes de décision.

**Gate :** mêmes invariants de provenance et de review pour les deux providers ;
budget maximal écrit dans le diagnostic ; zéro sélection par simple position.

## F6 — Migration et validation intégrale

**Objectif :** migrer le catalogue et démontrer le parcours utilisateur de bout
en bout.

**Procédure :** sauvegarde vérifiée, prévisualisation, migration transactionnelle,
réconciliation idempotente, attente des jobs, audit des identités et assets,
smoke Web/API/extension, puis validation utilisateur.

**Tests :** typecheck, tests unitaires et worker/API, build, intégration PostgreSQL,
Playwright, backup/restore, queue et diagnostic live. Les tests d’intégration
sont marqués bloquants lorsqu’ils nécessitent une base indisponible.

**Gate :**

- compteur de favoris et reviews avant/après documenté ;
- zéro job sans consommateur ;
- zéro titre fournisseur injecté dans les alias source ;
- chaque œuvre est résolue, en review ou explicitement sans résultat ;
- aucun asset actif invalide/orphelin ;
- aucune route utilisée par l’application en 500 ;
- rollback testé sur une base de restauration, jamais par suppression destructive.

## Commandes de validation

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @favlib/api db:migrate
pnpm --filter @favlib/api test:integration
pnpm test:e2e
```

Les commandes nécessitant PostgreSQL, Docker ou des fournisseurs réels doivent
être annotées `EXECUTED`, `SKIPPED` ou `BLOCKED` avec leur cause. Une commande
non exécutée ne constitue pas une preuve de gate.
