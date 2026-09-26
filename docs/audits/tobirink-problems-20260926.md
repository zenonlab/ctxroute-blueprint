# Tobirink — problèmes, preuves et corrections proposées

Date : 26 septembre 2026. Statut : audit terminé, produit non certifié.

## Conclusion

Le blocage n'est pas seulement un manque de tests exécutés. Plusieurs tests
actuels passent tout en laissant subsister des défauts de résolution, de
reprise et de certification. La production effectue encore des recherches
sans publier de résultat. La candidate testée n'est pas celle téléchargée.

Cet audit distingue les **défauts reproduits**, les **observations de
production**, les **limitations documentées** et les **preuves manquantes**.
Les solutions ci-dessous sont proposées, **pas implémentées par cet audit**.
Les lots correctifs exécutés ensuite sont distingués dans le suivi en fin de
rapport. Les deux canaris explicites sont désormais prouvés ; cela ne certifie
pas la résolution par titre ni la convergence du profil réel.
Une reproduction qui termine avec succès démontre le défaut, pas sa correction.
Ce rapport ne prétend pas recenser tout défaut possible du logiciel.

## Périmètre et traçabilité

- Code testé : `d12782fe259bb975cbac17683fa342189555cdb5`, arbre produit du
  merge `main` `d9be35d91c7385644716836ffac4939543c9b224`.
- Répertoire des tests : `build/clones/discovery-provider-bounds-clean/`,
  nommé **clone audité** ci-dessous. Les chemins de code et leurs lignes
  désignent cette révision, pas les modifications non livrées du dépôt parent.
- Sources : code, tests locaux, rapports installés existants, GitHub Actions,
  lectures Cloudflare MCP agrégées, pages publiques effectivement consultées.
- Aucun déploiement, POST d'admission, réarmement historique, SQL de mutation,
  changement de permissions, commit ou push pendant cet audit.
- Seul document versionnable ajouté : ce rapport. Les scripts de reproduction
  sont des artefacts locaux ignorés. Les modifications préexistantes sont préservées.
- Aucun titre, URL de favori, identifiant privé, contenu IndexedDB ou secret
  n'est inclus dans ce rapport. Les exemples des reproductions sont synthétiques.

## État observé

| Contrôle | Résultat réel | Ce que cela ne prouve pas |
| --- | --- | --- |
| Playwright Chromium relancé | **9 réussis, 1 ignoré**, 15,7 s | Pas 10 réussites ; pas la convergence fournisseur réelle |
| Worker actif, lecture du 26/09 à 05:48 UTC | `2a2023ce-59be-43dc-83ee-d737dc4df3b5`, trafic 100 % | Pas une certification du profil utilisateur |
| Queue déployée | `max_batch_size=1`, `max_concurrency=1`, 8 retries | Ne sérialise pas les admissions HTTP `worker-direct` |
| D1 à 05:48 UTC | 455 VERIFIED, 416 FAILED, 28 NOT_FOUND, 16 AMBIGUOUS, 3 PENDING, 0 PROCESSING ; 370 œuvres | Les 416 FAILED ne sont pas tous des bugs actuels ni une autorisation de réarmement |
| Trois PENDING à 05:56 UTC | Âge 61,9–62,1 heures ; tentatives 2 ou 3 | Pas leur cause individuelle, ni leur association au profil privé |
| `/`, `/library`, `/download` | HTTP 200 ; `/download` propose **1.0.43** | Pas la livraison de la candidate **1.0.44** |
| Gateway Deno `/healthz` | HTTP 200, `no-store` | Pas son SHA déployé ni un appel signé complet avec stockage/rejeu |

### Production : activité sans progression dans la fenêtre examinée

Fenêtre UTC **04:54:09–05:54:09 le 26 septembre**, filtre du Worker
`tobirink-public-api`, lecture MCP des événements `worker.cost`, plafond
2 000 événements, 284 reçus, dont 142 collecteurs Discovery :

| Mesure Discovery | Valeur |
| --- | ---: |
| Résultat `backoff` | 142 / 142 |
| Appels fournisseur | 662 |
| Résultats publiés/acceptés | 0 |
| Réponses fournisseur 429 | 1 |
| Erreurs HTTP fournisseur | 1 |
| Lignes D1 lues / écrites | 9 353 / 2 176 |
| Maximum lu par collecteur | 69 |
| Collecteurs au-dessus de 300 lectures | 0 |
| Échecs d'émission Queue rapportés | 0 |

Une seconde requête, sur la même fenêtre, trouve 142 avertissements
`public-discovery-provider-failed`, tous classés `provider-unavailable`.
Les 142 autres événements de coût sont `agenda-recovery`, avec 142 émissions
Queue. Ces nombres sont des agrégats de logs, pas une facture D1 complète,
ni une attribution individuelle à un favori ou à un canari. Zéro échec
d'émission ne certifie pas l'absence d'erreur d'exécution Queue ou CPU.

## Problèmes et solutions testables

### 1. P1 — Les erreurs fournisseur peuvent contourner indéfiniment le plafond d'essais

**Défaut reproduit et symptôme de production concordant, causalité individuelle non établie.**

- Source : `packages/public-discovery/src/collector.ts:46`,
  `packages/adapters-cloudflare/src/catalogue/d1-public-discovery-v3-adapter.ts:415`.
  Une erreur de recherche devient `FavoriteProviderRetryError`; le report
  `defer` décrémente la tentative, même après des appels fournisseur réels.
- Preuve locale : vrai collecteur, résolveur, cinq adaptateurs et SQL D1
  exécuté dans SQLite mémoire ; réponses HTTP 503 simulées ; dix passages
  espacés au-delà du circuit ouvert donnent **50 appels**, dix reports,
  `attempt=1` à chaque claim, état final **PENDING, attempt_count=0**.
  Le plafond de huit essais n'est donc jamais atteint dans ce scénario.
- Solution : distinguer attente de cadence **avant appel** et échec **après
  appel** ; conserver un budget durable d'appels/échecs et une échéance globale.
  Une panne prolongée doit devenir explicitement terminale ou nécessiter une
  reprise volontaire, sans recréer une boucle automatique.
- Test de correction : 503 persistants et erreurs réseau après émission
  consomment un budget fini ; attente de cadence sans appel ne le consomme
  pas ; arrêt après épuisement ; aucun réarmement automatique des FAILED.

### 2. P1 — La CI échoue avant D1 et masque la cause

**Défaut de configuration et diagnostic reproduit dans les exécutions réelles.**

- Source : `.github/workflows/deploy-production.yml:89` transmet le token
  mais pas `CLOUDFLARE_ACCOUNT_ID` à l'étape de diagnostic, contrairement
  aux étapes de plan/application. `scripts/infra/public-discovery-diagnostics.mjs:28`
  remplace tout échec par une erreur générique, puis `:47` n'en garde que
  les noms des métriques absentes. Le subprocess n'a pas de timeout explicite.
- Preuve : run `36221054289`, tentatives 1 et 2, et run `36221547526`
  échouent avant l'application. Les douze commandes des trois étapes à
  05:35, 05:40 et 05:44 UTC échouent sur **GET `/accounts`, Forbidden 9109**.
  Les logs Wrangler proviennent du checkout du runner self-hosted
  `actions-runner-tobirink/_work/Tobirink/Tobirink`, pas d'une simulation.
- Correction du diagnostic précédent : **aucune panne D1 ni erreur PATH
  n'est démontrée ici**. La découverte du compte est refusée. L'expiration
  éventuelle ou les permissions exactes du token ne sont pas déterminées.
- Solution : transmettre l'ID déjà disponible ; vérifier une lecture D1
  avec l'identité exacte de CI ; erreurs classifiées sans stderr brut ni
  secret, timeout borné. Ne pas élargir les permissions par défaut.
- Test de correction : présence de l'ID pour chaque invocation Cloudflare ;
  cas compte absent/refusé, authentification D1 refusée, délai dépassé,
  JSON invalide et stderr contenant un faux secret. Puis étape CI réelle
  réussie ; l'ajout de l'ID seul ne prouve pas les droits D1.

### 3. P1 — Une branche peut appliquer le Worker de production avant fusion

**Comportement observé, contraire à la frontière de livraison depuis main.**

- Source : `.github/workflows/deploy-production.yml:6`, `:27`, `:106`.
  Le dispatch et l'application Worker n'imposent pas `refs/heads/main`.
  Seule la publication des archives possède cette restriction à `:149`.
- Preuve : le run **36197711047**, branche `perf/discovery-reference-guard`,
  SHA `d12782f`, applique effectivement le Worker le 25/09 vers 22:44 UTC.
- Solution : conserver vérifications et plan sur branche ; réserver
  l'application production à `main`, sans ajouter d'approbation interactive.
- Test de correction : matrice push-main/dispatch-main/dispatch-branche ;
  sur branche, aucune commande `infra:apply` production ne peut s'exécuter.
  Le test actuel `tests/ci-security.test.mjs:16` ne couvre que le filtre push.

### 4. P1 — Une mauvaise saison ou un OVA peut être certifié VERIFIED

**Défaut métier reproduit.**

- Source : `packages/public-discovery/src/resolver.ts:49`.
  `matchQueryFor` omet `season` et `sourceFormat` de la demande.
- Preuve : demande saison 2, `NON_OVA` ; candidat de même titre saison 1,
  `OVA` ; résultat réel **VERIFIED**, saison 1/OVA.
- Solution : transmettre toutes les contraintes au matching unique et
  revérifier leur compatibilité après hydratation.
- Test de correction : titres identiques, saisons et formats contradictoires ;
  aucun candidat incompatible ne devient VERIFIED, même après hydratation.

### 5. P1 — Le filtre adulte perd la classification MangaDex à l'hydratation

**Défaut de filtrage reproduit.**

- Source : `packages/public-discovery/src/providers/mangadex.ts:103` ;
  `packages/domain/src/favorites/contracts.ts:90`.
  La recherche classe le contenu ; `hydrate()` omet cette classification.
- Preuve : `contentRating=pornographic` produit une classification absente ;
  le vrai `isContentVisible(candidate, false)` retourne **true**.
  Ce filtre est utilisé par Library, Review et notifications.
- Solution : réutiliser le même mapping dans recherche et hydratation.
- Test de correction : matrice safe/suggestive/erotica/pornographic de
  l'adaptateur jusqu'aux trois surfaces, avec le filtre adulte désactivé.

### 6. P1 — Un collecteur peut libérer la réservation fournisseur d'un autre

**Défaut de concurrence reproduit sur le vrai SQL.**

- Source : `packages/adapters-cloudflare/src/catalogue/d1-provider-runtime-control.ts:45`.
  Succès/échec remet `active_until` à zéro sans propriétaire de réservation.
- Preuve SQLite : arrivées à 0, 0 et 3 secondes ; première complétion à
  1 seconde ; départs autorisés à **0, 8 et 11 secondes**. Le deuxième appel
  peut durer jusqu'à 16 secondes : cinq secondes de chevauchement possible.
  Toutes les attentes respectent pourtant la limite de huit secondes.
- Solution : bail avec jeton propriétaire, libération conditionnelle,
  acquisition/revalidation au départ réel, partagé par les collecteurs.
- Test de correction : trois appels concurrents, succès/échec tardif,
  durée maximale, Discovery et Agenda ; aucune libération du bail d'autrui.
  La Queue 1/1 seule ne protège pas le chemin HTTP direct.

### 7. P1 — MangaUpdates peut éliminer le bon candidat avant le matching métier

**Défaut reproduit.**

- Source : `packages/public-discovery/src/providers/mangaupdates.ts:91`.
  L'adaptateur filtre par qualité de titre sans les contraintes métier
  complètes ; le résolveur rejette ensuite le candidat restant.
- Preuve synthétique : même page avec `Target/Novel` et `Targat/Manga`,
  demande manga sans prépublication : **NOT_FOUND**. Contrôle conservant
  le candidat manga jusqu'au résolveur : **VERIFIED**.
- Solution : conserver les candidats bornés jusqu'au matching métier,
  ou transmettre toutes les contraintes à un seul matching partagé.
- Test de correction : roman au titre exact et manga compatible au titre
  légèrement divergent ; le premier ne doit pas supprimer le second.

### 8. P1 — Une recherche interrompue rejoue ses premières pages sans avancer

**Limitation fonctionnelle documentée, reproduite ; pas une nouvelle régression.**

- Source : `packages/public-discovery/src/resolver.ts:80`,
  `packages/public-discovery/src/collector.ts:45` ; absence de checkpoint
  reconnue dans `docs/decisions/ADR-0047-portable-public-discovery-component.md:71`.
- Preuve : huit tentatives relisent **[1,2,3,4] huit fois**, 32 pages,
  aucune cinquième page. Le test Queue `:72` couvre également 144 appels
  (`8 × 18`) aboutissant à `ATTEMPT_LIMIT`.
- Solution : checkpoint borné fournisseur/alias/curseur/candidats utiles,
  budget global, distinction entre travail incomplet et panne fournisseur.
- Test de correction : candidat exact page 5, interruption après page 4,
  redémarrage ; reprise page 5 sans relire 1–4 ni dépasser le budget global.

### 9. P1 — Le mode direct ne garantit pas la poursuite serveur autonome

**Limitation de code, preuve de convergence après coupure manquante.**

- Source : `apps/worker/wrangler.jsonc:69`,
  `apps/worker/src/catalogue/public-discovery-routes.ts:31`,
  `apps/worker/src/native-collectors.ts:327`.
  `worker-direct` appelle le collecteur avec continuation désactivée.
- Preuve : les tests confirment un 503 si aucune publication n'aboutit.
  Le client peut resoumettre ; une réparation serveur est planifiée
  quotidiennement (`apps/worker/src/index.ts:79`). D'autres signaux Queue
  peuvent aussi traiter des demandes : ce n'est pas un blocage définitif.
- Solution : admission durable avec signal et reprise serveur vérifiables,
  indépendants de la connexion HTTP ; mode direct seulement comme secours borné.
- Test de correction : arrêter HTTP puis navigateur au milieu d'une recherche
  par titre ; résultat terminal serveur sans nouveau POST client.

### 10. P1 — Une reprise extension peut se terminer sans admission reçue

**Défaut de signalement/reprise reproduit, avec ambiguïté de livraison réelle.**

- Source : `apps/extension/runtime/favorite-resolution-continuation.ts:115`.
  Le curseur est persisté avant POST ; après panne réseau, un lookup
  `UNAVAILABLE` fait avancer puis effacer ce curseur.
- Preuve avec vrai adaptateur HTTP et stockage mémoire : **1 POST tenté,
  0 livré**, un lookup, curseur absent, source toujours `PROVIDER_UNAVAILABLE`.
  Trois exécutions successives ne rétablissent pas la demande.
- Solution immédiate : afficher « admission incertaine, action nécessaire ».
  Pour automatiser sans danger : reçu/version d'admission ou idempotence
  serveur distinguant demande non reçue et demande reçue puis épuisée.
- Test de correction : panne avant réception et perte de réponse après
  réception ; aucune fin silencieuse ni réarmement aveugle en double.

### 11. P1 — Extraire le ZIP Chrome dans un autre dossier change l'identité

**Défaut de parcours de mise à jour reproduit dans Chromium réel, hors ligne.**

- Source : `apps/extension/wxt.config.ts:18` ; ZIP 1.0.44 sans clé Chrome.
  `apps/extension/scripts/installed-review.mjs:258` teste seulement le
  remplacement dans le même dossier.
- Preuve : même profil, archive identique, dossiers A et B. Redémarrer A
  conserve ID et marqueur `storage.local`; charger B change l'ID et le
  marqueur devient inaccessible. L'ancienne base n'est pas supprimée,
  mais la nouvelle installation ne la voit pas.
- Solution immédiate : procédure de mise à jour dans le **même répertoire**,
  Reload et export privé préalable. Une distribution à identité stable
  nécessite une migration explicite. Ajouter une clé rétroactivement
  changerait aussi l'identité : ce n'est pas une réparation transparente.
- Test de correction : upgrade même dossier avec données privées synthétiques ;
  autre dossier avec avertissement/migration documentée ; deux redémarrages.

### 12. P2 — Les exclusions n'ont pas de raison individuelle accessible

**Écart à la demande utilisateur, exclusion elle-même intentionnelle.**

- Source : `packages/application/src/library/project-pending-favorites.ts:71`,
  `apps/extension/entrypoints/options/ResolutionStatus/ResolutionStatus.tsx:94`.
  Les sources `UNSUPPORTED` sont exclues ; Options fournit un total et
  une phrase générique, pas une liste expliquant chaque source.
- Preuve : test `read-library-catalogue.test.ts:117` et 39 exclusions
  `IDENTITY_MISSING` dans le dernier rapport réel hors ligne.
- Solution : vue locale paginée des exclus, motif exact et ouverture du favori,
  sans transmission de ces données au serveur.
- Test de correction : identité manquante, taxonomie bloquée, détachement ;
  raisons par source et compteurs cohérents, aucune disparition silencieuse.

### 13. P1 — Le certificat canari accepte du trafic sans rapport et un coût excessif

**Faux positif reproduit, sans réseau.**

Corrigé ensuite par la PR 111 ; preuve réelle distincte dans le suivi canari.

- Source : `scripts/infra/manga-canary.mjs:129`, `:247`, `:279`, `:297`.
  Le compteur fournisseur agrège la fenêtre entière ; aucun plafond D1
  n'est appliqué à la condition de réussite.
- Preuve : fixtures simulées VERIFIED/VERIFIED, uniquement du trafic Kitsu
  sans rapport, **0 résultat accepté, 3 erreurs HTTP, 3 événements failed,
  2 999 998 lignes lues** ; verdict réel du script : **COMPLETE**.
- Solution : corrélation opaque non privée par traitement, fournisseur
  attendu, résultat accepté, erreurs corrélées bloquantes et plafond de
  **300 lignes par invocation (collecteur + admission)**, distinct des
  lectures de surveillance.
- Test de correction : trafic concurrent seul, mauvais fournisseur,
  zéro publication et échec corrélé refusés ; 300 accepté, 301 refusé.
  Cette reproduction ne prouve pas que les précédents canaris réels
  étaient faux ; elle prouve que leur certificat ne suffit pas.

### 14. P2 — Les canaris par identifiant contournent la recherche des favoris

**Preuve de parcours manquante.**

- Source : `scripts/infra/manga-canary.mjs:63`,
  `packages/public-discovery/src/resolver.ts:298`.
  `explicitProviderReference` déclenche l'hydratation directe, sans recherche
  de titre, alias, pagination ou matching saison/OVA.
- Preuve : le run antérieur `36195622439` a donné deux VERIFIED avec les
  identités attendues et rapporté un appel fournisseur/un résultat accepté
  dans chaque fenêtre. Ces canaris ciblent l'hydratation explicite ; leur
  certificat agrégé ne prouve pas l'attribution individuelle des appels,
  et ne certifie pas la recherche représentative des favoris.
- Solution : conserver ces canaris, ajouter une certification bornée
  **sans référence explicite**, avec identité attendue connue.
- Test de correction : recherche observée, bon résultat, reprise après
  interruption, budget mesuré, puis projection dans l'extension.

### 15. P2 — Les E2E verts ne testent pas toute la promesse asynchrone

**Lacunes de tests constatées.**

- Source : `apps/web/e2e/packaged-extension.spec.ts:48` retourne MISS puis
  directement VERIFIED au POST. Les 1 400 œuvres sont injectées en IndexedDB
  (`:172`, `:222`), pas résolues ; le redémarrage porte sur leur lecture.
- Les routes fournisseurs sont simulées, mais seul un compteur de recherche
  particulier est affirmé nul ; absence globale d'appels MV3 non démontrée.
  `apps/web/e2e/public-extension-network.spec.ts:11` est ignoré sans
  `TOBIRINK_TEST_ARCHIVE`; même activé, son POST est simulé en PENDING.
- Autre piège : `package.json:47`, `npm run test:e2e` à la racine lance les
  tests de l'extension, pas Playwright. `npm run verify` (`:105`) ne contient
  pas Playwright ; la CI protégée le lance dans une étape distincte.
- Solution : faux serveur stateful MISS → PENDING → réveil → VERIFIED,
  compteur global interdisant les fournisseurs MV3, arrêt entre admission
  et résultat ; commande E2E non ambiguë ; gate ZIP public non ignorable.
- Test de correction : une admission, zéro fournisseur extension, reprise
  durable, compteurs exacts ; la gate de livraison échoue si le test requis
  est ignoré. Garder séparés le smoke non-mutant et la certification réseau.

### 16. P1 — La convergence des 1 522 favoris et la base personnelle restent non certifiées

**Preuve manquante, et non affirmation que tous les favoris échouent aujourd'hui.**

- Dernier rapport du clone :
  `build/installed-review/tobirink-installed-review-WK2Ywp.report.json:1`,
  25/09 22:03 UTC, version 1.0.44, `offline-regression-passed`,
  **converged=false**, 1 522 favoris, **0 identifié**, 1 483 NETWORK,
  39 IDENTITY_MISSING, données conservées aux redémarrages.
- `privateDatabaseCopied=false`, `personalProfileCertified=false` : le
  runner réimporte titres/URLs dans un profil temporaire, pas l'IndexedDB
  personnelle avec progressions et décisions (`installed-review.mjs:159`).
- Rapport online historique du dépôt parent `9glkgj`, 23/09 : `incomplete`,
  132 résolus, 11 Review, 41 exclus, 603 retryable et 735 processing. Les deux
  catégories non terminales totalisent **1 338** sources; 132 seulement sont
  résolues. Ces mesures précèdent les derniers correctifs et ne décrivent pas
  l'état actuel.
- Solution : stabiliser le parcours par titre, tester un échantillon réel
  borné dans une nouvelle session, puis les 1 522 favoris ; vérifier séparément
  une copie autorisée de la base personnelle, sans modifier l'original.
- Test de correction : conservation du nombre de sources et de l'identité,
  raisons terminales par source, zéro attente inexpliquée, projection
  correcte, décisions/progressions conservées après arrêt MV3 et navigateur.
  Importer 1 522 liens hors ligne n'est pas ce certificat.

### 17. P1 — Le téléchargement public reste en 1.0.43

**Livraison incomplète, décalage volontaire tant que la candidate n'est pas certifiée.**

- Source : `apps/extension/package.json:3` = 1.0.44,
  `apps/web/published-extension.json:2` = 1.0.43 ; page
  `apps/web/app/download/page.tsx:13`. Lecture HTTP publique concordante.
- Solution : après certification seulement, publier les deux archives
  immuables, vérifier leurs téléchargements/SHA, puis promouvoir séparément
  le pointeur Web. Ne pas écraser 1.0.43 ni publier pour masquer le problème.
- Test de correction : ZIP réellement téléchargé, version et digest
  conformes ; mise à jour à identité stable et données conservées.

### 18. P2 — Progress et certaines descriptions donnent une impression de réussite excessive

**Incohérences documentaires constatées.**

- `.project/progress.json` marque `extension-profile` DONE dans
  `goal-align-1042-discovery-production-20260920`, alors que le certificat
  personnel reste absent. Une preuve récente annonce dix E2E Chromium ;
  le résultat réel est **neuf réussites et un test ignoré**.
- `docs/decisions/ADR-0037-favorite-analysis-contract.md:69` interdit le
  fallback après 403/429 ; l'ADR-0046 révisée le 23/09 (`:141`) l'autorise.
  Le code et ses tests suivent la décision récente : **ne pas qualifier
  ce fallback de bug ni le supprimer sans nouvelle décision produit**.
- `docs/architecture/src/discovery-recovery.dataflow.json` valide neuf
  contrôles showcase, mais représente le chemin Queue. Le mode HTTP direct
  déployé doit être distingué du chemin cible de reprise ; le validateur
  graphique ne vérifie pas la fidélité du schéma à la production.
- Solution : certificat par niveau — import, conservation, résolution,
  production, publication — avec SHA/archive et état passed/skipped/missing ;
  réconcilier Progress via son outil, ADR et diagramme sans réécrire l'historique.
- Test de correction : aucun DONE de certification si sa preuve obligatoire
  manque ou est ignorée ; règle courante unique et chemin actif documenté.

## Ce qui est réellement corrigé ou sain

- L'ancien scan D1 massif lors de publication n'est pas listé comme défaut
  encore actif : les tests workerd sur le code audité donnent **78 lectures /
  39 écritures**, fixture 582 œuvres/2 328 titres/582 références ; fixture
  production-sized **246/113** ; rejeu **51/0** ; lookup d'une clé **2 lectures**.
- La fenêtre de production examinée ne dépasse pas 69 lectures par
  collecteur Discovery. Cela ne borne pas la dépense totale d'une boucle
  de collecteurs, ni tous les futurs profils de publication.
- Les contrôles du plan Cloudflare conservent un digest, un seul target
  `worker:tobirink-public-api`, les routes, et une publication R2 séparée
  du pointeur Web. Le défaut de branche du point 3 reste distinct.
- Le code d'import/conservation et plusieurs parcours locaux passent.
  Les performances de tri E2E observées sont de 43–53 ms, puis 124 ms après
  redémarrage du service worker. Cela ne prouve pas la résolution réseau.

## Tests et reproductions exécutés pendant cet audit

Commandes depuis le clone audité, sauf validation du rapport depuis la racine.
Les comptes par suite ne doivent pas être additionnés aveuglément : certains
tests infra sont exécutés dans plusieurs commandes.

| Commande / périmètre | Résultat |
| --- | --- |
| `npm run test:e2e --workspace @tobirink/web -- --workers=1` | 9 passed, 1 skipped |
| `npm test --workspace @tobirink/public-discovery -- src/resolver.test.ts src/providers/mangadex.test.ts src/provider-http.test.ts --reporter=dot` | 54/54 |
| `npm test --workspace @tobirink/worker -- src/catalogue/public-discovery-queue.test.ts --reporter=dot` | 26/26 |
| `npm test --workspace @tobirink/worker -- src/catalogue/public-discovery-query-cost.test.ts src/cost-baseline.test.ts --reporter=dot` | 13/13 |
| `npm run test --workspace @tobirink/extension -- runtime/favorite-resolution-continuation.test.ts runtime/favorite-resolution-d1-boundary.test.ts runtime/local-library-catalogue-runtime.test.ts entrypoints/options/ResolutionStatus/ResolutionStatus.test.tsx` | 24/24 |
| `npm test --workspace @tobirink/application -- src/library/read-library-catalogue.test.ts src/favorites/public-discovery-resolution.test.ts src/favorites/favorite-resolution-runner.test.ts` | 58/58 |
| `npx vitest run scripts/release/package-extension.test.mjs` | 6/6 |
| `node --test scripts/infra/*.test.mjs` | 74/74 |
| `node --test scripts/infra/public-discovery-diagnostics.test.mjs tests/ci-security.test.mjs` | 6/6 |
| `npm run archify:validate -- discovery-recovery.dataflow` | 9 contrôles, 0 erreur, 0 avertissement |

Reproductions complémentaires conservées localement, hors source produit :

```sh
cd build/clones/discovery-provider-bounds-clean
node ../../audits/worker-product-reproductions.mjs
node ../../audits/worker-provider-attempt-reproduction.mjs
node .output/audit-20260926/extension-identity.mjs
node .output/audit-20260926/extension-recovery-network.mjs
node .output/audit-20260926/canary-false-positive.mjs
```

Ces cinq commandes ont été relancées par l'agent principal. Assertions
réussies : défauts reproduits. Aucun accès fournisseur réel. La reproduction
de concurrence exécute le SQL dans SQLite mémoire ; celle d'identité utilise
Chromium hors ligne avec données synthétiques. Les fichiers sous `build/`
ne sont pas versionnés et ne remplacent pas les futurs tests de régression.

`npm run verify` n'a pas été relancé intégralement pour ce rapport : son
passage précédent et celui du run protégé `36197711047` restent des preuves
datées, distinctes des tests ciblés relancés ici. Aucune correction proposée
dans ce rapport ne peut être déclarée validée par ces tests verts existants.

Validation du rapport : `npm run validate:docs -- --all` et contrôles
`git diff --check` réussis ; trente références de code vérifiées présentes
avec lignes existantes dans le clone. Deux relectures indépendantes ont
contrôlé les parties extension et livraison. La nuance d'attribution des
compteurs canaris a été corrigée avant remise.

Les trois scripts initialement sous `build/audit-20260926` sont conservés
depuis le lot correctif sous `.output/audit-20260926`, à profondeur identique
pour préserver leurs imports. Ce répertoire est déjà exclu du lint produit ;
aucune règle ESLint n'a été assouplie et aucune preuve n'a été supprimée.

## Suivi correctif après audit — lot approuvé le 26 septembre

Branche isolée `fix/discovery-recovery-prerequisites-20260926`,
[PR 110](https://github.com/tristan-monticelli/Tobirink/pull/110),
commits `106e069` et `e7bac7e`. Les autres modifications du dépôt parent
n'ont été ni intégrées ni supprimées.

| Point | Correction et preuve nouvelle | Limite |
| --- | --- | --- |
| 1 — essais remboursés après panne | Le résolveur conserve les erreurs consommantes à travers les lanes et fallbacks ; dix passages simulés, huit essais, arrêt des appels, FAILED/ATTEMPT_LIMIT | La deadline Worker 30 s reste remboursable ; ce n'est pas un budget universel |
| 2 — diagnostic CI | Compte explicite, timeout 15 s, sortie 1 Mio, codes fermés ; étape D1 réelle réussie sur la branche | Aucun droit ni secret modifié |
| 3 — déploiement depuis une branche | `main` obligatoire pour apply, probes et canaris ; ces étapes et les archives sont réellement ignorées dans le run de branche | GitHub déclare `main.protected=false` et aucune règle d'environnement ; la protection ici est le workflow, pas une règle de branche |
| 18 — précision des preuves | Diagramme distingue HTTP direct et Queue, limites des retries et conditions de reprise | Les autres incohérences historiques du rapport ne sont pas déclarées toutes résolues |

Validation du lot : `npm run verify` réussi, audit npm zéro vulnérabilité,
134 tests Discovery et 188 tests Worker complets, dont 31 Queue ciblés.
Playwright est relancé : neuf réussites et un ignoré. Archify
`discovery-recovery.dataflow` passe 9/9, zéro erreur, zéro avertissement.
Les régressions préservent la cadence/429 pure, l'échéance maximale, les
fallbacks réussis, le profil VERIFIED et l'absence de faux NOT_FOUND après panne.

Le [run de branche 36224247585](https://github.com/tristan-monticelli/Tobirink/actions/runs/36224247585)
valide le SHA exact `e7bac7efbffbdf686dc0712fec53ea80398fc5f0` : packaging
isolé, Playwright, vérification complète, diagnostics D1 et plan Worker
unique/routes conservées passent. Le run termine avec succès ; aucune
application production sur cette branche.

La PR 110 est fusionnée dans `main` sous
`45f77fee3920c8b9a0f05c73db4ddd441460a619` après ce succès. Le
[run main 36224727557](https://github.com/tristan-monticelli/Tobirink/actions/runs/36224727557)
réexécute les contrôles et termine avec succès : un seul Worker appliqué,
plan digest `0e3b8cb07d293e0d3e2c19d48e5b4eb081910675a080f0d27fa1fbb3df29b50f`,
canaris et archives ignorés. Les quatre probes publiques répondent 200.

Lecture MCP à 06:52:49 UTC : version Worker
`5d1bcbb6-dd7b-458d-afc9-905f743f0b84` active à 100 %, déployée à 06:51:03 ;
Queue toujours batch 1/concurrence 1, huit retries. D1 garde 455 VERIFIED,
416 FAILED, 28 NOT_FOUND, 16 AMBIGUOUS ; les trois demandes actives passent
de PENDING à PROCESSING. À 06:53:26, leurs compteurs sont 3 (une demande)
et 4 (deux), sans SQL de mutation exécuté par l'agent.

Observation courte après déploiement, 06:51:03–06:53:05 : trois collecteurs
Discovery, quatorze appels fournisseur, zéro résultat accepté, trois backoffs,
zéro 429 et zéro échec d'émission Queue rapportés ; 193 lignes D1 lues,
37 écrites, maximum 67 lectures par collecteur. Les champs sont présents dans
les trois événements. La vue runtime jusqu'à 06:53:44 retourne trois issues
`ok`, CPU maximal 55 ms, aucun `exceededCpu` ou exception dans cette fenêtre.
Cette observation bornée vérifie l'absence d'erreur runtime observée, **pas la
convergence fournisseur** : aucun nouveau VERIFIED n'est encore démontré.

Aucun canari, réarmement historique, migration D1 ou publication d'extension
n'est exécuté par ce lot. Les défauts métier, la corrélation canari et la
certification des 1 522 favoris restent ouverts ; ce lot ne suffit pas à
déclarer le produit opérationnel de bout en bout.

### Certificats canaris corrélés — 26 septembre, 07:51 UTC

La [PR 111](https://github.com/tristan-monticelli/Tobirink/pull/111), commit
`38232a73da0d67d6f0a9d955538934d2e70b2a9c`, corrige uniquement l'observateur,
ses tests, le runbook et le diagramme. Le certificat exige une seule enveloppe
HTTP associée à la réponse d'admission, le fournisseur attendu, un résultat
accepté et le coût D1 cumulé collecteur/admission au plus 300. La deadline
de cette admission directe est portée à 45 secondes, contre 15 pour les
lectures ; la campagne reste bornée à 24 minutes et ne rejoue jamais un POST.

Validation : `npm run verify` passe, audit npm zéro vulnérabilité,
104/104 tests infrastructure et sécurité CI, dont 39 tests canari relancés
indépendamment. Les délais virtuels 16 et 32 secondes passent ; 45 secondes
interrompent sans deuxième admission. Le faux certificat par trafic étranger,
les coûts absents ou supérieurs à 300, les doublons et erreurs sont refusés.
Archify `discovery-recovery.dataflow` passe 9/9 sans erreur ni avertissement.

La [CI de branche 36226903110](https://github.com/tristan-monticelli/Tobirink/actions/runs/36226903110)
réussit sur le SHA exact, sans apply, probes, canari ni publication. La fusion
`eb231735d30d0dd04ffa77f770ace69eb54cb31a` passe ensuite la
[CI main 36227374601](https://github.com/tristan-monticelli/Tobirink/actions/runs/36227374601) :
un Worker appliqué, quatre probes 200, aucune admission canari ou archive.
Les E2E comptent neuf réussites et un test ignoré, pas dix réussites.
Le ZIP public téléchargé reste hors de cette preuve Playwright standard.

Une seule campagne autorisée est déclenchée dans la
[CI 36227767710](https://github.com/tristan-monticelli/Tobirink/actions/runs/36227767710),
même SHA, canaris activés et publication désactivée. Le run réussit ; les
certificats corrélés sont relus indépendamment depuis ses logs :

| Canari public | Terminal | Appels / acceptés | Lectures D1 | Écritures D1 |
| --- | --- | --- | --- | --- |
| Odd Taxi / AniList | VERIFIED | 1 / 1 | 111 = 90 collecteur + 21 admission | 17 |
| Spirit Circle / MangaUpdates | VERIFIED | 1 / 1 | 123 = 102 collecteur + 21 admission | 17 |

Chaque clé neuve reçoit exactement une admission, puis un terminal à la
première lecture d'observation. Le certificat `COMPLETE`, de périmètre
`correlated-discovery-requests`, couvre 48 083 ms : deux appels, deux résultats
acceptés, 234 lectures et 34 écritures D1. Les compteurs retries, erreurs
HTTP/réseau, 429 et échecs Queue sont tous zéro. Aucun UUID de requête,
enveloppe brute ou contenu privé n'est publié dans ces rapports.

Contrôle MCP de la fenêtre 07:50:41–07:51:30 UTC : 35 événements retournés
pour 35 annoncés, dix outcomes `ok`, CPU maximal 46 ms ; aucun worker.error,
signal health, HTTP 429, dépassement CPU ou outcome d'exception observé.
Cette fenêtre bornée n'affirme rien sur des événements non reçus ou d'autres
périodes. À 07:54:38, la version Worker
`eaa9fa6c-22c1-4353-a10e-7ddfe05d1de2` était active à 100 % pendant cette
fenêtre; la Queue était alors 1/1.
Le SELECT agrégé D1 retrouve 457 VERIFIED (455 avant), 416 FAILED inchangés,
3 PROCESSING, 16 AMBIGUOUS et 28 NOT_FOUND. Son propre coût de diagnostic
est 1 840 lectures, zéro écriture, distinct du coût des canaris.

Aucun réarmement historique, migration ou publication d'extension n'a lieu.
Ces identifiants explicites prouvent le chemin fournisseur direct, **pas la
recherche par titre, la reprise Queue ni la projection des 1 522 favoris**.
Le goal global discovery-recovery reste donc incomplet.

### Contrôle du profil conservé — 26 septembre, 07:16 UTC

L'export `Downloads/favoris_20_09_2026.html` et le profil temporaire `WK2Ywp`
existent toujours. Le répertoire d'extension temporaire avait perdu son
manifeste et ses fichiers racine ; seuls les fichiers absents ont été
restaurés depuis le ZIP Chrome 1.0.44 de SHA-256
`fe737a9235b3de7532648e82d2b4062b8b0b0dc9bbe17d43a0701c6f59a9fa50`,
sans écraser les fichiers présents ni modifier la base originale. Ce n'est
pas une certification de mise à jour d'extension.

Une copie du profil de test est ouverte hors ligne avec proxy fermé et
résolution DNS bloquée dès le lancement. L'identité d'extension est
conservée ; la version annonce 1.0.44. Les lectures IndexedDB retrouvent
1 522 sources et zéro œuvre stockée. La préparation des identités à partir
des artefacts conservés produit 1 482 sources analysables, 1 345 clés uniques
et 40 sources sans identité ; aucun artefact ne manque. L'écart avec le
rapport précédent (39 sans identité / 1 483 NETWORK) reste explicite :
ce diagnostic des artefacts n'est pas une nouvelle exécution du runner.

Une requête SQL strictement SELECT lit les états D1 et leurs échéances :
918 lignes lues, zéro écriture. Le rapprochement en mémoire, pondéré par
source, donne 397 VERIFIED, 384 FAILED, 16 AMBIGUOUS, 19 NOT_FOUND,
3 PROCESSING et 663 MISS. Ces 1 482 sources, plus les 40 sans identité,
retrouvent exactement le total de 1 522. Aucune des correspondances VERIFIED
n'est expirée au moment du contrôle.

Ces 397 correspondances VERIFIED ne sont **pas 397 œuvres projetées dans
Library** : la copie contient toujours zéro œuvre. Ce contrôle prouve la
conservation des sources et mesure le déficit du cache public, sans admission,
réarmement, appel fournisseur ou journalisation des titres/URLs/clés. Les
associations sync ne sont pas chargées. La base personnelle, la convergence
en ligne et les décisions/progressions restent non certifiées.

### Premier lot historique borné — 26 septembre, 08:30 UTC

Le runner privé, scellé sur une unique demande MANGA
`FAILED/ATTEMPT_LIMIT`, a créé son reçu `0600` puis consommé son seul POST.
La réponse est `202` et la ligne atteint `VERIFIED` à 08:30:40 UTC. Le
candidat MANHWA est lié, `request_json` est minimisé, les champs d'échec sont
effacés et le matcher de production accepte le titre au niveau
`ordered-exact`. Aucun second POST n'est autorisé.

La télémétrie corrélée attribue à cette invocation deux appels MangaUpdates,
un résultat accepté, 256 lectures et 106 écritures D1. Elle rapporte zéro
429, erreur HTTP/réseau, échec Queue ou retry. L'enveloppe Worker répond 202,
termine avec `outcome=ok`, 31 ms CPU, aucune troncature et aucun événement
d'erreur. Pendant cette opération, le Worker
`eaa9fa6c-22c1-4353-a10e-7ddfe05d1de2` était actif à 100 %; la Queue était
non pausée avec batch 1/concurrence 1.

Le runner termine néanmoins par `result-media-mismatch` parce que sa garde
locale exigeait `MANGA === MANHWA`, plus stricte que la compatibilité métier
du produit. Ce refus ne nie pas le terminal D1; il empêche seulement le runner
de produire son propre certificat. La preuve finale combine donc l'état D1,
le matcher de production et la télémétrie, sans rejouer l'admission.

Après l'opération, D1 contient 458 VERIFIED, 418 FAILED, 28 NOT_FOUND et
16 AMBIGUOUS. Une autre ligne PROCESSING a terminalisé simultanément; les
totaux agrégés seuls ne prouvent pas l'identité d'une transition. Cette reprise
unique ne projette toujours aucune œuvre dans la Library du profil conservé et
ne certifie pas les 1 522 favoris.

### Garde réseau du profil installé — 26 septembre 2026

Le manifeste de l'archive impose désormais une directive CSP native
`connect-src https://tobirink.com`, une surface racine exacte et des permissions
exactes. La directive ferme aussi les WebSockets du service worker MV3; le
compteur Playwright WebSocket n'est qu'un tripwire de page, pas cette preuve. Le
runner contrôle le manifeste avant chargement puis installe sa barrière HTTP.
Seules les lectures Discovery/Agenda
explicitement listées peuvent joindre l'origine TobiRink; admissions et refresh
partagent un budget de zéro à deux. Reçus mutationnels, slots de lecture et
sceau d'échec restent privés en `0600` et survivent à la reprise.

La candidate locale porte les SHA-256 Chrome `d04072bc846a90e66b820647469da50934eb2a74d3873fabe23c4fc5063f4a17`
et Firefox `862049a83d831dacbc2f7cf7b3c6571273e332482299e74d0a9db6f1ca2afe5a`.
Le packager exige la même CSP, l'unique origine, les permissions, le content
script et les clés racine exactes dans les deux manifestes. Les tests couvrent
les en-têtes non déclarés, les capacités manifestes injectées, un 429 tardif
drainé, le sceau relu à la reprise, un abort suspendu et une fermeture WebSocket
suspendue : après le sceau, aucune seconde requête ne peut réserver ou sortir.
La fermeture Chromium est bloquante : une erreur de fermeture ou un handler
encore actif interdit le certificat.

Un smoke neuf sur deux favoris du véritable export termine
`offline-regression-passed` après redémarrage du service worker puis du
navigateur : deux mutations tentées et bloquées, cinq lectures servies
localement, zéro lecture/admission/refresh transmis, zéro accès
fournisseur/étranger/WebSocket et `inFlight=0`.

La reprise exacte du profil complet schema 3, sans réimport ni remplacement
d'archive, termine `offline-regression-passed` en conservant **1 522 / 1 522**
sources : zéro `processing`, 1 483 `retryable` et 39 `unsupported`. Elle vérifie
les deux redémarrages; 109 mutations sont tentées et bloquées, 307 lectures sont
servies localement, et lectures, admissions, refreshes, fournisseurs, origines
étrangères et WebSockets transmis restent tous à zéro avec `inFlight=0`.

Cette preuve certifie l'import et sa terminalisation hors ligne, pas la
convergence fournisseur. Aucun profil navigateur personnel non temporaire avec
exactement 1 522 favoris et la base TobiRink correspondante n'a été trouvé; la
base personnelle reste donc non certifiée. Aucun POST de production n'est
exécuté par ce lot.

Le contrôle Cloudflare MCP strictement en lecture seule de 10:14 à 10:16 UTC
retrouve le Worker `85e6f045-dc3b-4f22-be8e-f095179bf9f7` actif à 100 %, la
Queue principale à batch 1/concurrence 1 et backlog zéro. La DLQ conserve ses
13 messages historiques sans lecture de leur contenu. Le SELECT D1 agrégé
compte 458 VERIFIED, 418 FAILED, 28 NOT_FOUND et 16 AMBIGUOUS, aucun
PENDING/PROCESSING; il consomme 1 840 lectures, zéro écriture et ne change pas
la base. La télémétrie retenue depuis ce déploiement contient zéro 429, erreur
metadata, `exceededCpu` ou exception. Cette preuve est bornée à la fenêtre et
aux événements conservés par Cloudflare.

## Preuves encore nécessaires

- La même preuve corrélée pour la recherche par titre et la reprise Queue :
  la paire explicite du 26 septembre ne couvre pas ces parcours. Les erreurs
  antérieures observées ne sont pas effacées par sa fenêtre saine.
- Parcours complet par titre et vrai profil personnel ; pas seulement
  identifiants explicites, catalogue injecté ou import de favoris hors ligne.
- Smoke Firefox installé et validation de mise à jour ; deux builds ZIP
  ne constituent pas un test navigateur Firefox.
- SHA de la gateway Deno et parcours authentifié avec protections anti-rejeu ;
  son endpoint health seul ne suffit pas.
- Téléchargement et installation des archives réellement publiées après
  promotion. Une candidate locale et le produit public sont deux preuves.

## Ordre de réparation recommandé

1. Rendre la CI diagnostiquable et son application exclusive à main (2–3),
   puis borner les échecs après appel et fiabiliser les baux fournisseur (1, 6).
2. Corriger les identités métier et le filtre adulte avec tests rouges puis
   verts (4–5, 7). Ajouter la progression de recherche et les reprises (8–10).
3. Supprimer les faux certificats, couvrir le vrai asynchrone et la recherche
   par titre (13–15). Expliquer exclusions et mises à jour (11–12).
4. Certifier une session représentative puis les 1 522 favoris/base privée
   (16), réconcilier les preuves (18), et seulement alors livrer (17).

Pas de nouvelle reprise massive de FAILED pour compenser une panne de
résolution. Chaque correction doit avoir son test de non-régression avant
une nouvelle observation bornée de production. Cet audit ne clôture pas
le goal de convergence ou de reprise D1.
