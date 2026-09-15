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

## Publier le collecteur Public Discovery v3 à cadence dix minutes — BLOCKED

- [ ] **Pousser exactement 51742d9 vers le dépôt public et vérifier le trafic** — BLOCKED _(evidence: Commit public 51742d9 poussé et vérifié; tests locaux 51/51 et npm ls réussis., Routes publiques vérifiées: Discovery v3 et Agenda v3 répondent 200; Discovery v2 répond 410., external: aucun run schedule créé sur 51742d9 après plusieurs fenêtres */10; GitHub reste sans garantie de démarrage et ne satisfait pas la latence demandée.)_

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

## Limiter la gateway Deno aux appels AniList — BLOCKED

- [ ] **Router AniList via Deno et les autres fournisseurs directement** — BLOCKED _(evidence: external: Discovery MangaUpdates retourne provider-http-403 lorsque son appel sort directement de Cloudflare; le routage AniList-only ne peut donc pas préserver le trafic réel., L'essai a été annulé: Worker 28226f17-f805-4da7-98d9-6c21a8680792 restauré à 100 % et gateway Deno sxbj3m7zt0zc restaurée., Le runtime restauré est sain: une nouvelle demande AniList ID 1 est passée de PENDING à VERIFIED et Agenda v3 expose une génération MangaUpdates produite à 19:30 UTC.)_
