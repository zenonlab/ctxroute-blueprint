# Progress checklist

## Désactiver le protocole legacy Public Discovery v2 — DONE

- [x] **Répondre 410 aux routes v2 et retirer leur identité OIDC** — DONE _(evidence: Progress history archived to .project/progress-archive-2026-09-15.json, Worker tests 57/57 and all workspace typechecks pass, All legacy v2 route tests return 410; v3 remains covered)_

## Publier le retrait du protocole Public Discovery v2 — DONE

- [x] **Vérifier, versionner, pousser et déployer le Worker** — DONE _(evidence: npm run verify passed; pre-push lint, coverage, integration and documentation gates passed, Commit c0a797d pushed to origin/main without .codex/config.toml, Cloudflare plan 21460c98 deployed only worker:tobirink-public-api as version a1c2e5cc)_

## Sécuriser l’atomicité et les états de Public Discovery D1 — DONE

- [x] **Rendre la publication atomique et terminer les demandes épuisées** — DONE _(evidence: Tests D1 Cloudflare 15/15: bail remplacé, bail expiré, conflit fournisseur, huitième tentative FAILED/UNAVAILABLE et reprise POST identique sans écriture partielle, Tests HttpPublicDiscoveryAdapter 3/3 et FavoriteResolutionRunner 39/39: UNAVAILABLE ne déclenche aucun fournisseur ni resoumission automatique, Tous les typechecks passent; validations ADR et documentation passent)_

## Minimiser et dédupliquer Public Discovery — DONE

- [x] **Borner les titres, indexer les identités et définir la rétention** — DONE _(evidence: Contrats et génération applicative limitent et dédupliquent les deux listes à 4; tests Public Discovery 50/50 et runner 39/39, Migration D1 0014 ajoute index canonique versionné, échéances FAILED/nonces et plans d’index; tests Worker 64/64 couvrent 503, collision atomique, rejeu historique et expurgation, ADR-0046, stratégie qualité, runbook et dataflow mis à jour; Archify showcase 9/9, 0 erreur, 0 avertissement, artefact SHA-256 f4c47121bb5fdd54d7a1234c1946d201eb37b87b9f4d12aa212d4502fe7e9baa)_

## Aligner les contrats internes Public Discovery sur v3 — DONE

- [x] **Renommer le runtime, les tables et le schéma filaire vers v3** — DONE _(evidence: Contrat portable 51/51, adaptateur navigateur 3/3 et Worker 65/65 passent avec schemaVersion 3 et noms V3., Migration 0015 renomme les tables actives vers _v3; test D1 prouve la conservation d’une ligne PENDING et la disparition de l’ancien nom., Le test FAILED réarme par POST identique puis réclame attempt 1; audit rg ne trouve des marqueurs v2 que dans transitions, test négatif et routes 410.)_

## Préparer le collecteur public v3 à cadence dix minutes — DONE

- [x] **Synchroniser et vérifier le dépôt public localement** — DONE _(evidence: Clone public local propre sur refactor/public-discovery-v3; commit 51742d9 sans push, dispatch ni mutation fournisseur., Sources alignées exactement sur packages/public-discovery/src; contrat v3, listes 4+4 et état UNAVAILABLE couverts par 51 tests., npm ci --ignore-scripts, npm run verify et npm ls réussissent; workflow */10 et workflow_dispatch conservé; lockfile inchangé.)_

## Retirer les fournisseurs du runtime de l’extension — DONE

- [x] **Acheminer les identités manuelles par Public Discovery v3** — DONE _(evidence: Manual Review uses a provider+ID-specific SHA-256 key and Public Discovery v3; PENDING and exact VERIFIED behavior are covered by 7 application and 25 extension targeted tests., Chrome/Firefox manifests expose only https://tobirink.com/*, no declarativeNetRequest permission/resource; executable background bundles contain none of the four provider API origins., npm run verify and npm ls pass after the shared toolchain alignment; no provider call, deployment, publication, push or file deletion was performed.)_

## Aligner l’outillage workspace et le gate CI — DONE

- [x] **Unifier TypeScript et rendre npm ls bloquant** — DONE _(evidence: npm ci --ignore-scripts and npm ls pass with one TypeScript 7.0.2 baseline and @types/node 24.10.15., All workspace typechecks and 141 targeted UI tests pass; npm run verify passes fully with npm audit reporting 0 vulnerabilities., CI runs npm ls on every matrix OS, npm run verify on Ubuntu, and cross-platform validation on macOS and Windows; ADR-0048 and coherence checks pass.)_

## Borner WebBridge et renforcer la confiance OIDC — DONE

- [x] **Plafonner les sessions locales et le cache JWKS** — DONE _(evidence: WebBridge tests 7/7 prove 32-session LRU, 64 IDs per session, 512 IDs globally, closed quotas and expired-session purge behavior., OIDC tests prove immutable repository 1370309060 and owner 239743354, 3-second abort, 5-minute cache reuse/expiry, kid rotation and 16-key rejection; security suites pass Extension 9/9 and Worker 15/15., All workspace typechecks and npm run verify pass; npm audit reports 0 vulnerabilities and Chrome/Firefox MV3 builds succeed.)_

## Aligner l’identité produit, la confidentialité et les preuves publiques — DONE

- [x] **Corriger les métadonnées et la documentation produit active** — DONE _(evidence: Web 13/13, toutes les suites workspace et tous les typechecks passent; Extension 148/148, Worker 65/65, Application 378/378., npm run verify réussit intégralement, builds Chrome/Firefox inclus; npm audit rapporte 0 vulnérabilité et npm ls est propre., Archify valide et matérialise les diagrammes en showcase 9/9 sans erreur ni avertissement; production-surface artefact e3d5d6a1adcdbfa60a081463bea01ed32c2e18c33c3fdeb9dc9b6ddf19e209c2, extension-delivery artefact d4cfc9cb3835e6a0566c0daf1f58af9ef2ef55e4880223b819852dd668783188.)_

## Distinguer la cadence Discovery déployée de la cible locale — DONE

- [x] **Corriger la cadence dans le diagramme de pipeline publique** — DONE _(evidence: Le diagramme distingue Discovery quotidien 03:23 UTC déployé et cible dix minutes locale non poussée., Archify showcase passe 9/9 sans diagnostic; artefact public-pipeline 8f88a348680d90c136b5e01ef6377f295a8cceb2174950c90f0018f25ef0304e., Validations ADR/docs et build documentaire réussissent; le npm run verify complet du commit précédent est vert.)_

## Retirer les fallbacks fournisseur morts de l’extension — DONE

- [x] **Supprimer les runtimes directs et préserver la compatibilité IndexedDB** — DONE _(evidence: Dix fichiers legacy supprimés; aucun symbole fournisseur/fallback actif trouvé hors tests négatifs., Chrome et Firefox MV3 construits à 20 fichiers, uniquement https://tobirink.com/*, sans DNR., Migration IndexedDB v19 Chromium réussie; npm run verify, npm ls --all, npm audit et git diff --check réussissent.)_

## Certifier la candidate extension 1.0.31 sans fournisseur — DONE

- [x] **Versionner, packager et certifier 1.0.31 localement** — DONE _(evidence: Candidate 1.0.31: Chrome 291601 octets SHA-256 a4bf87ecc73f03566ad84d8a6b2d8ee61dae0fe6e1cbf3f9f1897afb81dbd390; Firefox 291642 octets SHA-256 01657bc68988fc97360881f7a2f6bd431e52d82dbfc95440fb0ca58a545e3358., Deux builds isolés byte-identiques; 20 fichiers chacun, manifestes uniquement https://tobirink.com/*, aucun DNR ni origine fournisseur dans le background., npm run verify, npm ls --all, validations ADR/docs et git diff --check réussissent; npm audit 0 vulnérabilité.)_

## Sauvegarder D1 avant toute suppression historique — DONE

- [x] **Exporter et vérifier la base D1 de production** — DONE _(evidence: Export D1 distant réussi vers build/backups/tobirink-public-pre-cleanup-a111b2a.sql., Fichier ignoré par Git, 789390 octets, SHA-256 f203567fb0a0767c8c9278ad4c15542df7dceadc247ec59ce82e1383069a2f9f., Contrôle post-export: 8 owners, 8 installations, 3 receipts, 1 quota et 1 requête Discovery inchangés; meta changes=0 et changed_db=false.)_

## Versionner la preuve de sauvegarde D1 — DONE

- [x] **Valider et commiter la preuve opérationnelle** — DONE _(evidence: validate:docs -- --all et validate:decisions (50 ADR, 437 scopes) réussis., git diff --check réussi; aucun changement dans AGENTS.md, CLAUDE.md, .codex/hooks.json ou .claude/hooks., Le diff versionné reste limité aux deux fichiers Progress; le dump et .codex/config.toml sont exclus.)_

## Publier les remédiations et la preuve de sauvegarde sur origin/main — DONE

- [x] **Pousser le tip certifié vers origin/main** — DONE _(evidence: Push fast-forward réussi: origin/main pointe exactement sur ce6f43dbbc165afea77b4cb82a29cb5d355e066f., La modification utilisateur .codex/config.toml et le dump D1 sont restés hors push., Runs 34969133546, 34969133545 et 34969133539 créés puis arrêtés avant toute étape; runner_id=0 et annotation GitHub de paiement/plafond de dépenses.)_

## Déployer les migrations Public Discovery v3 et le Worker — DONE

- [x] **Appliquer D1 0013–0015 puis déployer le Worker v3** — DONE _(evidence: Cloudflare: migrations 0013–0016 appliquées; aucune migration restante; Worker db774555 à 100%., D1: 1 ligne VERIFIED conservée, minimized_count=1, request_json_bytes=2; lectures changes=0., Schéma: tables requests/nonces _v3, index canonique et index pending/FAILED/nonce présents; noms actifs _v2 absents.)_

## Pousser la correction et les preuves Discovery v3 sur main — DONE

- [x] **Pousser exactement 6dfe27c vers origin/main** — DONE _(evidence: Push fast-forward réussi: ce6f43d..6dfe27c; origin/main pointe exactement sur 6dfe27c41839fac8f2b78b74167737b135530431., Les gates pré-push locales lint, couverture, intégration et build documentaire ont réussi., Les runs 34975288611, 34975288507 et 34975288676 ont été créés puis arrêtés avant exécution par le blocage GitHub paiement/plafond.)_

## Remplacer GitHub Actions par des collecteurs Cloudflare et un proxy sortant — DONE

- [x] **Implémenter et certifier localement la Queue et le proxy signé** — DONE _(evidence: Worker 71/71 et Public Discovery 55/55 passent; les tests prouvent signal Queue opaque, 503 avec PENDING conservé, ack/retry, validation du message et proxy HMAC/allowlist/anti-rejeu/limites., npm run verify, npm ls --all, npm audit (0 vulnérabilité) et les builds Chrome/Firefox réussissent; le dry-run Wrangler reconnaît Queue, D1, R2, Images, Assets et rate limit sans déploiement., Archify dataflow Discovery et Agenda passent showcase 9/9, 0 erreur, 0 avertissement; artefacts 761e900d296cb5f0a5b37a2f5807cd1fde9529a01e1a19aa41a4fbb8d0d865c0 et c788c05477864ab9548fe710f28c23e2f96f06486304f263377ba2cfe4825d6f.)_

## Isoler et rendre interchangeable le transport fournisseur — DONE

- [x] **Retirer le proxy embarqué et composer un port de transport sélectionnable** — DONE _(evidence: ProviderTransportPort sépare les collecteurs des adaptateurs direct et gateway; la gate refuse mode, cible, origine ou secret invalides et direct est la valeur Wrangler par défaut., Le serveur provider-proxy et son test sont supprimés; rg ne trouve plus aucun symbole PROVIDER_PROXY, createSignedProviderProxyFetch ou createProviderProxyHandler dans apps et packages., Public Discovery 52/52 et Worker 78/78 passent; npm run verify final, npm ls --all, typechecks, intégration, Chrome/Firefox MV3 et npm audit à 0 vulnérabilité réussissent.)_

## Consolider les collecteurs natifs et retirer GitHub Actions — DONE

- [x] **Inventorier et sauvegarder le dépôt public** — DONE _(evidence: Bundle encodé ignoré: 97 101 octets; décodé 72 824 octets, historique complet, main et HEAD sur 51742d9; SHA-256 c41e16372290150a7c3937aa3fa7bf2588b4dc743fa75beee0ac1721aca796e2., Inventaire distant: une branche main, aucun tag, release, environnement, secret ou variable Actions, fork, étoile ou issue ouverte; 17 runs historiques., Parité: 27/27 sources publiques présentes dans le main, 24 byte-identiques; trois écarts expliqués par ProviderTransportPort et deux fichiers main-only.)_
- [x] **Étendre la gate Cloudflare aux deux Queues** — DONE _(evidence: Tests infra 23/23: opérations dérivées de wrangler.jsonc, inventaire lié au compte, refus de cible inconnue et traduction exacte Queue., Inspection distante confirme les deux Queues absentes; le plan réel contient exactement deux queue-create puis worker-deploy avec digest aa8ba694a7a4844a657cb5f5db484b068a7a66439e95ab1325dacd751ae80b8c., Dry-run Wrangler reconnaît Queue, D1, R2, Images, Assets, rate limit et PROVIDER_TRANSPORT_MODE direct sans mutation distante.)_
- [x] **Pousser, provisionner et déployer le runtime direct** — DONE _(evidence: Push fast-forward réussi: origin/main pointe sur 873f248377f4f74788d8218a0f071829c0cdb659; hooks lint, couverture, intégration et documentation verts., Gate Cloudflare 84196083 a créé uniquement les deux Queues autorisées puis déployé le Worker 2ae7a6f8 à 100%., Inventaire distant: Queue principale avec 1 producteur/1 consumer, DLQ avec 0/0; binding Worker présent et PROVIDER_TRANSPORT_MODE direct sans gateway ni nouveau secret.)_
- [x] **Certifier Discovery et Agenda en trafic réel** — DONE _(evidence: Discovery v3: la demande AniList 20 passe de 202 PENDING à VERIFIED sur le Worker d5d0ce85 avec le profil Naruto complet., Agenda natif: cron réel */10 à 17:30 UTC, traitement Queue en 47 s puis génération active calendar-d2732f2f avec 711 événements (225 AniList, 486 MangaUpdates)., Routes publiques après collecte: Discovery v3 et Agenda v3 répondent 200 sur les nouvelles révisions; Catalogue v2 répond 410.)_
- [x] **Ajouter une gateway isolée seulement si AniList bloque Cloudflare** — DONE _(evidence: Cinq retests directs depuis Cloudflare ont rendu provider-http-403 pour AniList; le transport gateway est donc requis et activé explicitement., La gateway Deno révision pbcbbjp6gzys utilise HMAC, nonce KV atomique, expiration, allowlist stricte et limites de corps; ses 7 tests et les 30 tests infra passent., Les smokes signés AniList et MangaUpdates répondent 200; Discovery AniList 20 atteint VERIFIED et Agenda publie 711 événements via la gateway.)_
- [x] **Retirer le runtime GitHub OIDC et les sept workflows** — DONE _(evidence: Les sept workflows, le validateur GitHub OIDC, les deux CLI HTTP, les scripts de publication externe et leurs exports sont retirés; les trois routes d'ingestion externes répondent 410., La recherche active ne trouve plus de runtime GitHub OIDC; les références historiques sont conservées seulement dans les chronologies explicitement remplacées., npm run verify réussit: 274 tests de gouvernance, tous les workspaces dont Worker 77/77 et Public Discovery 49/49, builds Chromium/Firefox, intégration et audit à zéro vulnérabilité.)_
- [x] **Pousser et redéployer le runtime nettoyé** — DONE _(evidence: origin/main pointe sur bb1a93be503517ad5715ebd72fb6879b4286da14 et exclut la modification utilisateur .codex/config.toml., Cloudflare sert à 100 % la version Worker 28226f17-f805-4da7-98d9-6c21a8680792; D1 n'a aucune migration restante et les deux Queues configurées existent., Trafic réel: AniList ID 1 passe de PENDING à VERIFIED, Agenda v3 répond 200 avec la génération calendar-57a1574653ac08a739f3d58bb7f05e2ca86a7f34a380eeec, et les routes retirées répondent 410.)_
- [x] **Supprimer le dépôt public devenu inutile** — DONE _(evidence: Le bundle décodé est valide, contient l'historique complet et pointe main/HEAD sur 51742d92602d91e66a45e7a62b6d687dbd566219; SHA-256 c41e16372290150a7c3937aa3fa7bf2588b4dc743fa75beee0ac1721aca796e2., Aucune dépendance active du dépôt principal ne vise tristan-monticelli/tobirink-public-discovery., Le dépôt exact tristan-monticelli/tobirink-public-discovery a été supprimé avec le compte propriétaire et l'API GitHub répond HTTP 404.)_
- [x] **Auditer le résultat et inventorier les secrets obsolètes** — DONE _(evidence: npm run verify réussit intégralement: 273 tests de gouvernance passent, 1 est ignoré, tous les workspaces passent, les deux builds MV3 passent et npm audit trouve 0 vulnérabilité., npm ci --ignore-scripts rétablit le lien workspace Deno puis npm ls --all réussit; agenda-release.dataflow passe Archify showcase 9/9 sans erreur ni avertissement., Aucun workflow GitHub Actions ni runtime github-oidc actif ne subsiste; le dépôt public répond 404 et les seuls secrets runtime sont PROVIDER_GATEWAY_HMAC_KEY côté Worker et Deno.)_

## Router les endpoints fournisseur bloqués via Deno — DONE

- [x] **Router uniquement les endpoints fournisseur bloqués via Deno** — DONE _(evidence: Le mode selective-gateway route AniList et les trois endpoints MangaUpdates via Deno; MangaDex et Kitsu restent directs. Les tests ciblés passent: Worker 11/11 et gateway Deno 7/7., La gateway Deno fgxmg2ayyank et le Worker ad9b8641-6825-4953-9551-cb193f233940 ont été appliqués par leurs gates sur les seules cibles approuvées., Deux demandes neuves atteignent VERIFIED: AniList ID 1 et MangaUpdates ID 22195008066. Discovery v3 et Agenda v3 répondent 200; Catalogue v2 et les trois routes d’ingestion retirées répondent 410.)_

## Corriger les écarts du pipeline et de sa documentation — DONE

- [x] **Fiabiliser l’observabilité et rétablir la vérité architecturale** — DONE _(evidence: Worker 81/81 et gateway Deno 7/7 passent; les tests Queue couvrent succès, signal invalide, retry, neuvième livraison vers DLQ et codes AniList/MangaUpdates bornés., npm ci --ignore-scripts, npm ls --all et npm run verify passent; les builds Chrome/Firefox réussissent et npm audit rapporte 0 vulnérabilité., Archify all et internal passent en showcase 9/9 sans erreur ni avertissement; Agenda, pipeline public, trafic et blueprint décrivent le runtime Cloudflare plus Deno sans GitHub Actions actif.)_

## Permettre la rotation HMAC Deno sans interruption — DONE

- [x] **Accepter une clé précédente bornée et étendre la gate Deno** — DONE _(evidence: La gateway accepte une clé courante et au plus une clé précédente distincte; 9 tests Deno couvrent les deux signatures, les clés faibles, dupliquées ou excessives et le démarrage fermé., La gate Deno ordonne l'installation de l'ancienne clé avant la mise à jour de la nouvelle, expurge les deux valeurs et expose une suppression sans valeur; 8 tests ciblés et les 33 tests infra passent., L'inspection Deno ne restitue que les noms et la classification des variables; toute valeur inattendue est supprimée de l'inventaire normalisé.)_

## Retirer les secrets HMAC des arguments de processus Deno — DONE

- [x] **Charger les clés par fichier temporaire privé et borné** — DONE _(evidence: Le driver Deno transmet chaque clé via env load avec exactement une variable autorisée; 11 tests ciblés prouvent l'absence de valeur dans argv et le rejet des environnements inconnus ou multi-clés., Le runner crée un fichier temporaire exclusif en mode 0600, nettoie son répertoire après succès et échec, et remplace toute erreur CLI brute par deno-provider-command-failed., Les 36 tests infra passent sans appel fournisseur; la suppression de la clé précédente reste une opération séparée et sans valeur.)_

## Publier le durcissement du pipeline fournisseur — DONE

- [x] **Pousser, déployer les deux runtimes et certifier le trafic** — DONE _(evidence: Worker 2267a691-68cf-4612-9ec8-e36e3c839ef3 sert 100 %; origin/main inclut le durcissement, la compatibilité Deno et la correction de warm-up jusqu’à 68105f2., La gate Deno accepte les deux formes d’inventaire sans valeur et a déployé uniquement la gateway via le plan fa6209d6c2f3167a011d36e725d53343714b6b457fe41ab025de9ae0e5a84b0b; révision 6sfwa9m7qpx0 routed., AniList et MangaUpdates atteignent VERIFIED; Agenda v3 répond 200; v2 et les routes collecteur retirées répondent 410.)_

## Éviter le blocage de warm-up de la gateway Deno — DONE

- [x] **Démarrer HTTP avant Deno KV puis republier la gateway** — DONE _(evidence: Gateway Deno 10/10, npm run verify, npm ls --all et npm audit passent; audit à 0 vulnérabilité; Archify public-pipeline.architecture passe 9/9 sans diagnostic., origin/main pointe sur 68105f231fafd7ecc30f2c5a9336e59cc45b1dcf; .codex/config.toml reste exclu., Plan Deno fa6209d6c2f3167a011d36e725d53343714b6b457fe41ab025de9ae0e5a84b0b limité à la gateway; révision 6sfwa9m7qpx0 routed sans mutation de secret ni KV.)_

## Implémenter le rafraîchissement public adaptatif — DONE

- [x] **Rendre Agenda hebdomadaire, reprenable et sensible aux changements** — DONE _(evidence: D1 21/21; public-discovery 51/51; worker 85/85., npm run verify réussi; npm ls --all exit 0; npm audit: 0 vulnérabilité; git diff --check réussi., Archify agenda-release showcase 9/9, 0 erreur et 0 avertissement; wrangler deploy --dry-run réussi.)_

## Dédupliquer et borner l’admission Discovery — DONE

- [x] **Coalescer la demande publique Discovery** — DONE _(evidence: Public Discovery 55/55, D1 25/25, Worker 90/90 et tous les typechecks passent., Rafale de 10 000 POST: un signal; lot de 20: un seul claim; outbox reprend un envoi Queue non confirmé., npm run verify, npm ls --all, npm audit (0 vulnérabilité), dry-run Wrangler et git diff --check réussissent.)_

## Réhydrater les œuvres actives sans interrompre les lectures — DONE

- [x] **Rafraîchir une fiche VERIFIED sans bloquer sa lecture** — DONE _(evidence: D1 26/26, Worker 91/91, Public Discovery 55/55 et adaptateur navigateur 3/3 passent; tous les typechecks sont verts., Les tests prouvent VERIFIED lisible pendant refresh, admission hebdomadaire unique, reconstruction exacte avec request_json expurgé, résultat identique sans révision, échec conservant le profil, changement validé et huit tentatives bornées., npm run verify, npm ls --all, npm audit (0 vulnérabilité), dry-run Wrangler et git diff --check réussissent.)_

## Indexer les relations vérifiées entre œuvres — DONE

- [x] **Publier les adaptations comme œuvres liées distinctes** — DONE _(evidence: Public Discovery 58/58, D1 27/27 et Worker 92/92 passent; tous les typechecks sont verts., Les tests prouvent des workId anime/manga distincts, une relation exacte atomique, une hydratation secondaire unique et le rattachement tardif de la cible., npm run verify, npm ls --all, npm audit (0 vulnérabilité), dry-run Wrangler et git diff --check réussissent.)_

## Orchestrer les réhydratations depuis l’extension — DONE

- [x] **Regrouper et étaler les vérifications des favoris échus** — DONE _(evidence: Le test de 500 favoris prouve dix lectures groupées de 50, un maximum de 20 admissions par réveil, 200 admissions sur dix réveils de données et une continuation persistante., Extension 145/145, Application 376/376, Domain 36/36, adaptateur navigateur 84/84, Public Discovery 59/59, Worker 93/93 et D1 28/28 passent; tous les typechecks sont verts., npm run verify, npm ls --all, npm audit (0 vulnérabilité), les builds Chrome/Firefox, le dry-run Wrangler et git diff --check réussissent.)_

## Mesurer et documenter le rafraîchissement public adaptatif — DONE

- [x] **Ajouter les compteurs expurgés et consolider l’architecture** — DONE _(evidence: Worker 96/96, D1 28/28 et Public Discovery 59/59 passent; tous les typechecks et les tests dédiés aux métriques expurgées sont verts., npm run verify, npm ls --all, npm audit (0 vulnérabilité), dry-run Wrangler et git diff --check réussissent; les builds Chrome et Firefox passent., Archify showcase passe 9/9 sans erreur ni avertissement: Agenda 29549fac4208f7b875d3c2f29049369792d299648524bb0bb75311ce9dbb78ef, Discovery 13a4049fc65d737e18cbd67c06056c04cb46ccc7a0dd6a3803bf1f5f11868239.)_

## Arrêter immédiatement tous les traitements fournisseur — DONE

- [x] **Suspendre Queue, routes et crons sans supprimer de données** — DONE _(evidence: API Cloudflare: routes=[], schedules=[], workers.dev enabled=false et previews_enabled=false pour tobirink-public-api., Queue ed005a14ec534110b350b06922100056: delivery_paused=true; producteur, consommateur et messages non purgés restent conservés., La version Worker 2267a691-68cf-4612-9ec8-e36e3c839ef3 reste servie à 100%; aucune migration ni version Worker n’a été déployée.)_

## Mesurer les coûts par œuvre, utilisateur simulé et Agenda — BLOCKED

- [ ] **Compléter la référence locale puis certifier les budgets natifs et distants** — BLOCKED _(evidence: Le blocage historique de quota est levé: D1 0017–0021 appliquée et Worker corrigé bfd038ea déployé le 2026-09-17., Références locales reproduites le 2026-09-17: 36/36 tests ciblés puis Worker 104/104; première résolution 55 écritures fixture, 50 admissions concurrentes 5 écritures, batch 50 MISS 0 écriture, Agenda 1798/70/76/76/77., Échantillon distant corrélé: HTTP 200, Worker bfd038ea, CPU 9 ms, wall 28 ms, providerRequests=0, d1RowsRead=64, d1RowsWritten=0; aucun identifiant ou payload conservé.)_

## Collecter les contenus adultes et contrôler leur affichage dans l’extension — DONE

- [x] **Vérifier toutes les API : AniList, MangaUpdates, MangaDex, Kitsu Anime et Kitsu Manga** — DONE _(evidence: AniList, MangaUpdates, MangaDex, Kitsu Anime et Kitsu Manga exposent désormais adult/non-adult/unknown à partir de leurs signaux natifs; absence ou ambiguïté reste unknown., Le champ optionnel contentClassification traverse ProviderCandidate, checkpoint et contrat Public Discovery sans conditionner la collecte ou le stockage., ADR-0056, stratégie qualité et adaptive-public-refresh.dataflow mis à jour; Archify showcase 9/9, 0 erreur, 0 avertissement.)_
- [x] **Ajouter le paramètre et bloquer affichage et actions lorsque désactivé** — DONE _(evidence: Préférence locale showAdultContent ajoutée, OFF par défaut et rétrocompatible avec les préférences persistées existantes., OFF filtre avant pagination/facettes/statistiques la bibliothèque, recherche, page, review, popup, Agenda et WebBridge; il bloque aussi les décisions et notifications adultes/inconnues sans supprimer ni recollecter., npm run verify vert; typechecks workspace, Application 376/376, adapters-browser 84/84, Extension 145/145, Public Discovery 59/59; builds Chrome et Firefox réussis.)_

## Reprendre D1 et le runtime corrigé après l’arrêt d’urgence — DONE

- [x] **Accès rétabli à la dernière inspection; vérifier quota, sauvegarde et barrières** — DONE _(evidence: Inspection Cloudflare réussie à 2026-09-16T19:49Z: authentification valide, Worker 2267a691-68cf-4612-9ec8-e36e3c839ef3 à 100%, routes/crons/workers_dev toujours fermés, Queue configurée et non reprise., D1 distant tobirink-public présente encore exactement les migrations 0017–0021 en attente; le dump frais build/backups/tobirink-public-adaptive-refresh-resume.sql fait 1 011 839 octets, SHA-256 da9b5db986d51b5d887f6652c5dc7fc4910ce23f4329693fd4733c0e1864dd2e., Plan dry-run D1 + Worker validé: digest 9db712aff496a1f2921d37eb67f7404d86963c6d5e44722b0ecf5eb7aa5c7ad9; Archify dataflow showcase 9/9, 0 erreur, 0 avertissement.)_
- [x] **Migrer puis déployer sous barrières et réactiver progressivement** — DONE _(evidence: Plan Cloudflare exact appliqué après reset et authentification rétablie: migrations D1 0017–0021 puis déploiement Worker; allowlist limitée à d1:tobirink-public et worker:tobirink-public-api., Vérification distante: D1 répond « No migrations to apply »; Worker bfd038ea-4596-49aa-9add-7de77af5056c sert 100%., Réactivation progressive terminée dans l’ordre route → cron → Queue: route tobirink.com/*, cron Cloudflare valide 23 3 * * SUN UTC, puis reprise tobirink-public-discovery; workers.dev reste désactivé.)_

## Établir une référence de coûts locale et un parcours auditable de reprise — DONE

- [x] **Mesurer les scénarios D1 locaux et consolider les objectifs sans mutation de production** — DONE _(evidence: 102 tests Worker / 13 fichiers passent, dont 6 scénarios nouveaux; TypeScript Worker, Oxlint ciblé, docs, 54 ADR/478 scopes et diff --check réussis., Rapport docs/operations/d1-cost-audit.md: compteurs D1 locaux, stock, 16 projections utilisateurs/œuvres, hypothèses, tarifs sourcés et lacunes; aucune attribution distante inventée., Objectifs consolidés et roadmap B–H validée non approuvée; ancien plan corrigé; aucune mutation produit/fournisseur, dépendance, secret, purge, push ou commit.)_

## Réduire localement les amplifications D1 mesurées — DONE

- [x] **Instrumenter HTTP et publier l’Agenda par différence atomique** — DONE _(evidence: Worker 103/103 and adapters-cloudflare 20/20 pass; both workspace typechecks, anti-slop gate, ADR/docs validation and git diff --check pass., Measured Agenda budgets are frozen: first reconciliation 1798 writes, unchanged 70, then one-event changes 76/76/77; retained pages drop from 65 to 13 and active projection remains 579 rows., Discovery same-work/new-key keeps catalogue revision and work revision unchanged; HTTP worker.cost includes exact D1 meta without fingerprint. Migration 0021 and Archify dataflow validate locally; no provider mutation, deployment, purge, subscription, push or commit.)_

## Consolider le plan maître et tous les objectifs actifs — DONE

- [x] **Créer la documentation A à Z et supprimer les contradictions d’objectifs** — DONE _(evidence: Plan maître A–J créé: état réel, explication des 100k, tableaux par œuvre/utilisateur, budgets 55/19/70/76–77/1798, seuils proposés, approbations, rollback et preuves., Roadmap et continuation corrigées vers 0017–0021; ordre D1 puis audit adulte tous fournisseurs, préférence OFF locale et publication extension séparée; objectifs historiques signalés non réexécutables., Archify workflow et dataflow passent showcase sans erreur/avertissement; validate:architecture, config, docs, 55 ADR/489 scopes, anti-slop et git diff --check passent; aucune mutation fournisseur, coût, secret, suppression, commit ou push.)_

## Catalogue durable, Agenda virtuel et collecte hebdomadaire maîtrisée — DONE

- [x] **Aligner documentation, ADR, Progress et architecture cible** — DONE _(evidence: Brief, stratégie qualité, ADR-0045/0055/0056, plan maître et audit de coûts alignés sur D1 courant, R2 opérationnel, Agenda virtuel, unknown visible et absence d’exploration relationnelle., Archify adaptive-public-refresh architecture et dataflow passent showcase 9/9 sans erreur ni avertissement., validate:docs, validate:decisions et git diff --check réussissent; aucun code produit ni mutation distante dans cette étape.)_
- [x] **Établir les budgets actuels reproductibles et les tailles réelles** — DONE _(evidence: Fixture locale: 2 copies VERIFIED identiques = 678 octets BLOB; après changement de compteur, 2 profils distincts = 696 octets; chaînes catalogue 15/59/6 octets., Le test métrique prouve qu'un payload de 64 000 caractères avec rows_written=1 compte une écriture native, sans coefficient de taille., Worker 105/105, tous les typechecks, validate:docs --all et git diff --check réussissent; aucun appel fournisseur ni mutation distante.)_
- [x] **Corriger la propagation et retirer l’exploration relationnelle** — DONE _(evidence: Commit 89911a4: aucune relation fournisseur ne crée de demande, de ligne relationnelle ni de signal Queue; les références exactes de même œuvre restent conservées., contentClassification traverse la fabrique de domaine et les contrats; Kitsu limite non-adult aux valeurs documentées G/PG/R, avec R18 adulte et valeurs inconnues couvertes., catalogueNeedsPublication compare le profil canonique complet, incluant compteurs et classification; les tests D1 couvrent refresh partiel, alias et changement de compteur.)_
- [x] **Introduire la fiche canonique courante par œuvre** — DONE _(evidence: Migration 0023: fiche unique par work_id, backfill du VERIFIED le plus récent, complétion non destructive et conflits de type isolés., Tests D1 29/29, Worker 105/105 et adaptateurs Cloudflare 20/20; lecture alias, refresh partiel, classification et compteur couverts., Tous les typechecks, ADR/docs, Archify architecture et workflow showcase passent; aucune ressource distante modifiée.)_
- [x] **Implémenter Agenda virtuel et stockage opérationnel R2** — DONE _(evidence: Migration 0024 et publication: un modèle courant par œuvre; projection locale bornée, date AniList prioritaire, prédiction manga historique limitée à 12, suspension hiatus/terminé/annulé et compteurs confirmés séparés., R2 porte signals, leases, pages, snapshots actifs + deux précédents et observations avec ETag/jets de propriété; pages temporaires 7 jours, snapshots référencés sans expiration; envoi Queue échoué laisse un signal PENDING vérifié., Agenda 34/34, Worker 109/109, adapters-cloudflare 23/23, Public Discovery 62/62, Domain 37/37 et tous les typechecks passent; cible locale 579 œuvres: D1 writes 2895/0/5, R2 writes 391/32/32; Archify dataflow et workflow showcase 9/9.)_
- [x] **Basculer Worker et extension avec compatibilité** — DONE _(evidence: Le Worker expose /v4/release-models paginé et lecture seule; le nouvel adaptateur valide les modèles et projette localement la fenêtre avant commit du cache IndexedDB; /v3/releases reste compatible., La politique locale masque uniquement contentClassification=adult, conserve unknown visible et atteint bibliothèque, recherche, popup, Review, Agenda, notifications et WebBridge sans badge ni nouveau réglage., Agenda 36/36, Worker 111/111, Extension 145/145, Application 380/380, adapters-browser 84/84; migration IndexedDB Chromium, E2E, tous les typechecks et builds Chrome/Firefox passent; Archify dataflow/workflow showcase 9/9.)_
- [x] **Certifier, versionner, pousser et déployer avant nettoyage séparé** — DONE _(evidence: npm run verify final réussi: Worker 112/112, toutes les suites workspace/typechecks/builds, audit 0 vulnérabilité; Archify dataflow showcase 9/9., Backup D1 frais: 965788 octets, SHA-256 c86bfc65279464fa635da53d9014fce42661beaec37734ba92cdb24d0a7d064a; migrations additives 0023/0024 appliquées et aucune migration restante., Branche origin/perf/adaptive-public-refresh sur 137b4b0; Worker 2e2e534b-7816-445c-992a-1576a7087ccd à 100%; /v3, /v4 et site répondent 200; inventaire de nettoyage différé documenté sans suppression.)_

## Réparer la publication des téléchargements et nettoyer les ressources orphelines — DONE

- [x] **Découpler la version publiée de la version source et verrouiller le contrat** — DONE _(evidence: Web 14/14 et npm run verify complets réussis; build statique /download contient seulement 1.0.30., Archify production-publication: showcase 9/9, 0 erreur/avertissement; visual-check sans overflow aux quatre résolutions en clair/sombre., Le pointeur apps/web/published-extension.json reste 1.0.30 tandis que la candidate source est 1.0.31; ADR-0036/0039 et release.md alignés.)_
- [x] **Supprimer uniquement la table relationnelle et la Queue orphelines** — DONE _(evidence: Backup D1 frais ignoré: 978242 octets, SHA-256 16261b340b2e1118e3a5f9b6a7f59fbc10a20a2b957e7bbdf1500aee31c23f76; plan borné b3a217a0561d3174499527b46dc21732ebd565981b5c7ee1937c38e9b03bae38., Migration 0025 appliquée et Queue tobirink-jobs-production supprimée via la gate; table catalogue_work_relations absente, aucune migration restante, Queues Discovery principale/DLQ intactes., Agenda préservé à 740 événements courants et 3 générations; D1 réduit de 1273856 à 1257472 octets; tests infra 38/38 et D1 30/30 passent.)_
- [x] **Déployer, pousser et certifier le résultat** — DONE _(evidence: Publication corrigée: apps/web/published-extension.json pointe 1.0.31; /download, ZIP Chrome et ZIP Firefox répondent 200 et les hashes distants correspondent exactement aux archives locales., Chrome 1.0.31 installé: smoke Review hors ligne, convergence automatique des favoris et Agenda virtuel sans requête fournisseur réussissent; manifest uniquement https://tobirink.com/*, sans DNR ni origines fournisseur., R2 promotion df8f2d8beaa37dd01095338998d3962de924bc30b3b875c27acfe109f33d715b puis Worker plan a63179af88b96eae46f3a57a56863f9a6209f283c0642f37c5f73cf1a7a0dbea appliqués; Worker 25589148-ce66-43ab-9634-ed6a6a635f10 sert 100 %, cron dimanche 03:23 UTC conservé.)_

## Empêcher les erreurs Agenda non gérées dans le service worker — DONE

- [x] **Sécuriser le listener d’installation et valider l’extension** — DONE _(evidence: npm run typecheck passe pour tous les workspaces., npm test --workspace @tobirink/extension passe : 32 fichiers, 145 tests., git diff --check passe; le listener onInstalled ne laisse plus de rejet non géré.)_

## Généraliser l’inférence des titres et sorties depuis les URLs — DONE

- [x] **Déduire le titre et la progression depuis le titre et le slug** — DONE _(evidence: L’évidence générique reconnaît les releases préfixées par un identifiant, dont le format bato.si numeric-id-ch_67., Les préfixes numériques et locales sont retirés uniquement après corroboration par un segment humain du titre du favori., Le cas Bato produit stableSlug a-wannabe-golden-gangster et le titre affiché A Wannabe Golden Gangster; les formats Asura et routes existants restent couverts.)_

## Consolider et publier TobiRink 1.0.34 — DONE

- [x] **Construire une candidate 1.0.34 cohérente** — DONE _(evidence: Application 81/81, Extension 145/145 et Web 5/5 passent; Bato conserve A Wannabe Golden Gangster/chapter 67, Comix produit Synthetic Journey au passage générique puis synthetic journey/MANGA avec site-rules-v3., La source extension vaut 1.0.34 et le pointeur publié reste 1.0.33; le test Web dérive les liens du pointeur et impose source >= publiée sans version codée en dur., Tous les typechecks workspace, validate:decisions, validate:docs -- --all et git diff --check passent.)_
- [x] **Supprimer les anciens chemins d’exécution** — DONE _(evidence: Les workflows suivis packages/public-discovery/.github/workflows/collect.yml et agenda.yml sont supprimés; le gate inspecte maintenant tous les chemins suivis avec git ls-files et interdit aussi src/run.ts et src/agenda/cli.ts., Le remote Git local public-discovery a été retiré; aucun dépôt distant ni workflow distant n’a été modifié., Le README du package et le diagramme public-pipeline décrivaient déjà le runtime local + Worker sans workflow; production-publication.dataflow passe showcase 9/9 avec 0 erreur et 0 avertissement.)_
- [x] **Corriger les métriques et rendre la DLQ exploitable** — DONE _(evidence: Worker 33/33 passe; collectorCost sépare providerRequests des pages Agenda réellement demandées et Discovery publie pagesRequested=0., Le scénario métrique prouve providerRequests=3 et pagesRequested=2; typecheck Worker, validate:docs -- --all et validate:decisions passent., Les dataflows Agenda et Discovery passent Archify showcase 9/9 avec 0 erreur et 0 avertissement.)_
- [x] **Sécuriser Deno et obtenir zéro avertissement** — DONE _(evidence: Le driver Deno charge les secrets sans --replace, conserve la clé précédente et le test de rotation vérifie l'absence de suppression de la clé courante., deno.jsonc racine, identique à la configuration canonique hors ligne vide finale, est supprimé; le driver reste ancré dans apps/provider-gateway., DiscoveryRowWithKey et existingRows inutilisés sont supprimés; les trois contrôles regex de caractères de contrôle sont remplacés par des contrôles explicites des code points ASCII 0x00-0x1f et 0x7f.)_
- [x] **Certifier et publier 1.0.34** — DONE _(evidence: npm run verify, npm ls --all, Web route tests, documentation and decision validation passent; npm audit signale zéro vulnérabilité., Deux exécutions de package:extension sont byte-identiques : Chrome 294587 octets, SHA-256 264a48e9e292baeb082474e7ceb6c499f9bc3ba0f9e6e8031951c5a98cf0ac6b; Firefox 294628 octets, SHA-256 201f633c0a2d02ed60dc9f02e101f74a941a832f66854064f8238841ed24d79d., Inspection Cloudflare du compte 6aef9b2e29d0671c8b5dd36b0b660f4b réussie; le plan d272ac3e68ac5b2a2a05f792fbdf95b18ffc5e99fd9fdc22e38ec04c0cdd78df ne contenait que les deux objets R2 1.0.34 et worker:tobirink-public-api.)_
- [x] **Rétablir une source de vérité unique** — DONE _(evidence: Audit final effectué sur AGENTS.md, CLAUDE.md, .codex/hooks.json et les hooks; aucun workflow GitHub Actions suivi ni ancien CLI exécutable ne subsiste., .codex/config.toml reste une modification utilisateur non suivie dans les commits; aucun secret n'a été placé dans Git., npm run verify final passe, incluant validation, typechecks, tests workspace, performance, intégration, audit npm et build Archify showcase.)_

## Expose adult mode and restore hydration observability — DONE

- [x] **Add adult mode to quick settings and extension visibility policy** — DONE _(evidence: QuickPreferences schema/defaults now include showAdultContent=false and the popup presents the third Réglages rapides toggle., The extension background passes the persisted adult-visibility preference to Web Bridge, library, search, review, agenda, and notification filters., Application 383/383, adapter preference test 1/1, extension 145/145, all workspace typechecks, and documentation Archify source update pass; git diff --check was rerun after removing an unrelated blank line.)_
- [x] **Audit Public Discovery hydration path** — DONE _(evidence: Worker hydration tests pass 114/114; the queue has one producer and one consumer, both attached to tobirink-public-api, and the DLQ remains without a consumer., Read-only Deno inspection confirms the production gateway app, production Deno KV database, and secret classification; GET /healthz returns HTTP 200 {status: healthy}., Production Public Discovery GET responds HTTP 200 with a valid MISS for a well-formed key, proving the route is reachable; no direct provider networking was restored. The signed provider result path remains unproven without creating a new remote discovery request.)_

## Publier le correctif de visibilité adulte de l’extension — DONE

- [x] **Prepare deterministic 1.0.35 candidate** — DONE _(evidence: Source and download pointer are now 1.0.35; ADR-0039 explicitly preserves immutable 1.0.34 archives., Two package:extension runs produced identical Chrome SHA-256 aff248dbe625d35491817783e91e3d7c1f7a2e4a801a67730f4ce22136b9992a (294650 bytes) and Firefox SHA-256 d29db3d098c0de07bad1ec35c54a8d9524b3a5ae6c80bf6473597b0efe51b25b (294691 bytes)., npm run verify passes completely, including extension/Worker tests, typechecks, npm audit and Archify build; no provider mutation occurred.)_
- [x] **Publish immutable archives and advance download pointer** — DONE _(evidence: Fresh Cloudflare plan ad369fa04811869892d34123b68199369bd9c52e24ddd7998d25619dd917753a contained only the two 1.0.35 R2 archives and worker:tobirink-public-api; apply completed with Worker version 2290749c-6da7-4bec-a091-f85297749f0c at 100%., Production /download announces only 1.0.35; both versioned downloads return HTTP 200 application/zip with immutable caching., Remote SHA-256 matches local archives: Chrome aff248dbe625d35491817783e91e3d7c1f7a2e4a801a67730f4ce22136b9992a; Firefox d29db3d098cde07bad1ec35c54a8d9524b3a5ae6c80bf6473597b0efe51b25b.)_

## Corriger, diagnostiquer et déployer le flux provider 401 — DONE

- [x] **Corriger la classification 401 et les diagnostics gateway** — DONE _(evidence: Gateway Deno 11/11, dont 401 signature invalid, AniList upstream 401 -> anilist-auth-failed, métriques bornées et absence de données sensibles., Worker transport 11/11; le Worker ne reçoit que la réponse gateway et ne contient aucun token AniList., deno check et tous les typechecks workspace passent.)_
- [x] **Étendre les tests du chemin complet Worker→Gateway→Provider→Queue→D1** — DONE _(evidence: D1/Worker catalogue suite passes 33 tests; public-discovery provider/resolver suite passes 17 tests., Worker Queue, D1 routes and native collector retry tests pass 30/30., Infra gate suite passes 38/38, including Deno secret redaction, previous-key rotation and bounded plans.)_
- [x] **Mettre à jour documentation, ADR et diagramme Archify** — DONE _(evidence: ADR-0051 and docs/operations/cloudflare.md describe 401 layer classification, AniList public auth policy, metric fields and rollback., public-discovery.dataflow JSON names the HMAC gateway boundary and validates showcase 9/9 with 0 errors and 0 warnings., validate:decisions and validate:docs -- --all pass.)_
- [x] **Valider le dépôt et préparer les plans fournisseurs** — DONE _(evidence: npm run verify exit 0; gateway 11/11, Worker targeted suites pass, validate:decisions and validate:docs -- --all pass., Archify public-discovery.dataflow showcase 9/9 with 0 errors and 0 warnings., Fresh Cloudflare/Deno inspections and bounded provider plans completed without exposing secrets; Worker version ec0ac27d at 100%.)_
- [x] **Déployer progressivement et vérifier le canary VERIFIED** — DONE _(evidence: Gateway revision 73cc4y4ctj1e and Worker version afbeaf62-6cb8-44fc-b416-6f1f0d4ad021 deployed; healthz is HTTP 200 healthy., Secret synchronization corrected the gateway-layer HMAC 401; post-rotation Deno logs show provider=anilist, status=200, upstream_status=200, auth_failure_layer=null, duration 417ms and retries=0., Synthetic request admitted with 202 PENDING, then explicit AniList canary reached VERIFIED; Queue logged ack-success with acceptedResults=1, providerRequests=1 and retries=0; D1 verified_at is set.)_

## Corriger classification et diagnostics des favoris — DONE

- [x] **Corriger les rejets reproductibles et les diagnostics de reprise** — DONE _(evidence: npm run verify exit 0: application 389/389, extension 146/146, Worker 114/114, builds Chrome/Firefox et audit npm sans vulnérabilité., Réimportation synthétique UNSUPPORTED vers READY couverte; version de nouvel adaptateur sans invalidation des clés existantes., Archify lifecycle showcase 9/9, zéro erreur/avertissement. Aucun déploiement; cause des 585 attentes réelles et erreur interne non établie sans diagnostics locaux.)_

## Publier la correction favoris 1.0.36 — DONE

- [x] **Publier la correction de classification des favoris** — DONE _(evidence: Commit bcf7c4e fix(extension): recover valid favorite links vérifié et poussé sur origin/perf/adaptive-public-refresh et origin/main; .codex/config.toml exclu., npm run verify passe: application 389/389, extension 146/146, Worker 114/114, gateway 11/11, builds Chrome/Firefox, audit npm 0 vulnérabilité; Archify lifecycle 9/9 et validations docs/décisions passent., Cloudflare plan f04e2ddfec1463372ded88ab94edc4f63326a0b2b692de1b7dbc074a046d52fc appliqué avec seulement deux R2 publish et worker-deploy; aucun D1/Queue/secret/gateway.)_

## Rétablir la reconnaissance et le traitement des favoris — BLOCKED

- [x] **Établir la référence brute et les régressions** — DONE _(evidence: Oracle brut 10/10; extraction 46 succès et 4 échecs attendus reproduits; nombre intrinsèque classé amélioration., Archify showcase 9/9 sans diagnostic; ADR validés, diff audité. Trois profils lus: 1562 liens; états privés IndexedDB non certifiés.)_
- [x] **Corriger extraction, résolution locale et récupération versionnée** — DONE _(evidence: Application 393/393 et contrats 14/14; quatre régressions corrigées; identité locale ancienne sans D1 et reçu de récupération unique testés., Contrat IndexedDB Chromium et migrations passent; tous les typechecks et Archify all passent; ADR-0037/0050 mis à jour.)_
- [ ] **Réparer les reprises publiques et certifier les parcours** — BLOCKED _(evidence: Régression de budget corrigée et publiée en 1.0.38 via goal-publish-discovery-egress-1038; suite complète et archives installées validées., Envoi réel depuis ZIP Chromium intact après préparation lente: deux POST, traitement Queue/fournisseur pour une demande neuve, puis deux sources résolues par alarmes. Vérification après déploiement réussie., external: certification du profil personnel indisponible; les tests installés portent sur des profils temporaires, pas sur la bibliothèque utilisateur. Une installation manuelle existante doit charger 1.0.38 en conservant son profil.)_

## Fusionner et publier la récupération des favoris 1.0.37 — DONE

- [x] **Valider fusionner pousser et déployer 1.0.37** — DONE _(evidence: npm run verify réussi; archives reproductibles 1.0.37 testées installées sur Chromium 153 et Firefox 155; lint, Archify all, docs/ADR et 14 tests web passent., Fusion fast-forward et push main 7c33e9e réalisés. Worker final ee48b6be-752e-4e1e-a681-8ea0eb43a3dc déployé via plan 45308dc106f81947b46cb8412ddd07860e56ff4009678ba12db0696b02f0eb7c., Deux canaries MISS puis VERIFIED, admissions serveur 177/176 ms et lectures 29/33 ms. Liens /download 1.0.37 et SHA-256 des deux archives publiques vérifiés après déploiement; détails docs/operations/cloudflare.md.)_

## Publier en autonomie le correctif d’émission 1.0.38 — DONE

- [x] **Certifier les archives et publier 1.0.38** — DONE _(evidence: npm run verify réussi; builds 1.0.38 reproductibles; corpus 1532/1400 installé sur Chromium 153 et Firefox 155 validé., Archive installée: deux POST réels après prélecture de 6 s, PENDING puis VERIFIED avec un appel fournisseur; deux résolutions par alarmes natives. Nouvelle exécution après déploiement: deux POST VERIFIED et deux résolutions., Fusion et push main bdb7eea réalisés; archives R2 publiques aux SHA-256 attendus, /download 1.0.38 vérifié. Worker a66e751f-6a83-4757-bff6-2778bfb361bf actif à 100 %, aucune migration. Preuves docs/operations/cloudflare.md.)_

## Fiabiliser la pipeline avec D1 canonique et R2 opérationnel — ACTIVE

- [x] **Reproduire les frontières défaillantes** — DONE _(evidence: 13 tests ciblés exécutés: 9 succès et 4 défauts reproduits par it.fails (réseau, concurrence R2, ancien bail, écrasement)., Typechecks Worker/Cloudflare et validate:docs passent; Archify showcase 9/9, 0 erreur/avertissement; diff audité. Aucun état privé ni déploiement certifié.)_
- [ ] **Fiabiliser reprise R2 Queue et publication durable** — PENDING
- [ ] **Aligner modèles D1 dates et contrats publics** — PENDING
- [ ] **Propager mises à jour et fiabiliser parsing local** — PENDING
- [ ] **Certifier parcours et préparer livraison** — PENDING
