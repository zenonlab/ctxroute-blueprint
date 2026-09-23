# Convergence des favoris — certification du 23 septembre 2026

## État

Corrections locales vérifiées; livraison et convergence du profil réel non
encore certifiées. Candidate extension `1.0.44`, pointeur public `1.0.43`.
Les versions publiées ne sont pas remplacées et les données privées ne sont
ni committées ni jointes aux artefacts CI.

## Défauts reproduits et corrigés

| Frontière | Défaut | Preuve de correction |
| --- | --- | --- |
| Reprise HTTP | Receiver perdu par copie du port, zéro admission | Vrai adaptateur : test rouge `reserveAdmission`, puis requête transmise |
| Identité | Clés différentes entre prélecture, runner et reprise | Fonction commune, références explicites et indices synchronisés testés |
| Recherche | Page incomplète classée `NOT_FOUND` | Pagination réelle; page suivante et bornes testées; aucun négatif sans recherche complète |
| MV3 | Pause et interruption perdaient la continuation | Curseur durable, échéance, alarme restaurée, exclusion mutuelle; 15 s / 10 admissions |
| D1 | Réarmement terminal contournant le plafond actif | Tests workerd au plafond : nouvelles clés et réarmements refusés, replay actif permis |
| Deno | Nonce expirant avant une enveloppe future encore valide | Rejeux testés avec décalages 0/30/60 s et borne inclusive |
| Diagnostic | Comparaison ISO/SQL erronée et âge confondu avec échéance | Agrégats SQLite par média; `created_at` et `retry_at` séparés; échec de lecture bloquant |
| Queue | Scan complet de l'historique sur réveil vide | Index partiels existants, sans migration, mesures workerd ci-dessous |
| Projection | Réparation globale et relectures unitaires à chaque alarme | Commit normal atomique; réparation explicite par lots sans transactions vides |
| Livraison | Prébuild extension répété avant packaging | Deux prébuilds redondants retirés; reproductibilité et tests performance conservés |

La reprise explicite rejoint le runner normal après `PENDING`. Une intégration
avec le vrai adaptateur HTTP, le stockage de contrat et un adaptateur recréé
aboutit à une source `RESOLVED`, son Work et son appartenance Library. Un
`UNAVAILABLE` persistant reste visible et récupérable, sans admission automatique
ni consommation d'essais lors d'une simple lecture.

## Mesures locales

| Scénario | Avant | Après |
| --- | ---: | ---: |
| Réveil Queue vide, 1 024 terminaux | 3 088 lignes D1 lues | 18 |
| Quatre claims et continuation, même historique | 12 524 lignes D1 lues | 175 |
| Réparation de 1 522 sources en attente | 16 transactions et 1 522 relectures individuelles | 16 pages, une lecture Library, zéro transaction/relecture individuelle |

Les écritures des scénarios D1 restent respectivement zéro et vingt. Ces
mesures portent sur des fixtures workerd, pas sur une facture Cloudflare ni
sur une limite universelle : les requêtes parcourent encore les actifs utiles.

## Validations

`npm run verify` passe entièrement, notamment les types, suites workspace,
tests Deno, contrats IndexedDB dans Chromium, tests infra et gouvernance,
budgets performance, audit de dépendances et diagrammes. L'audit npm ne signale
aucune vulnérabilité. Les tests Web E2E donnent neuf succès et un test réseau
public facultatif ignoré; cette omission n'est pas une preuve de production.
Une seconde exécution complète après les contrôles de livraison est verte;
la suite infra contient désormais 65 tests, tous réussis.

Suites directement concernées : application 430, extension 170, adaptateurs
navigateur 106, composant Discovery 96, Worker 158 et gateway Deno 13 tests.
Le runtime local Deno testé est `2.7.1`; le déploiement distant de ce code reste
une preuve distincte. Les nouveaux diagrammes passent les neuf contrôles
showcase, sans erreur ni avertissement de composition.

Le parcours installé a été reproduit sur huit favoris synthétiques hors ligne :
upgrade `1.0.43 → 1.0.44`, arrêt du service worker puis redémarrage Chromium,
huit sources et huit entrées Library conservées. Son verdict est explicitement
`offline-regression-passed`, avec `converged:false` et huit erreurs réseau
attendues. Aucune décision humaine ni progression n'était présente dans cette
fixture : ce résultat ne certifie pas la base privée du profil personnel.
Les contrôles du harness sont pérennisés dans les tests de packaging.

Les canaris protégés exigent maintenant une observation bornée des métriques
`worker.cost`, sans conservation des événements bruts. Une fenêtre vide ou
sans appel fournisseur reste en échec. Ces agrégats décrivent le trafic de la
fenêtre, pas le coût attribuable individuellement à chaque canari.

Les worktrees locaux sont conservés, exclus du seul audit du dépôt parent par
`/.worktrees/`. Un test garantit qu'une vraie source hors des racines déclarées
reste rejetée. `AGENTS.md`, l'import unique `CLAUDE.md` et les dispatchers
`.codex/hooks.json` restent inchangés. Aucun hook n'est contourné.

Deux builds indépendants et le packaging normal produisent les mêmes archives :

| Archive candidate | Octets | SHA-256 |
| --- | ---: | --- |
| Chrome MV3 1.0.44 | 303209 | `9e39e856e016fb8745046f5817cb8f7be72f2a1c573e2048b08817eaa0f1aa86` |
| Firefox MV3 1.0.44 | 303250 | `23c1e4262272f16a37bad918d7718457db3da52c8a25d1a493a9806ca70926ca` |

Permissions inchangées : storage, bookmarks, alarms, notifications, activeTab;
seule l'origine produit figure dans les permissions d'hôte. Aucune preuve de
publication R2 ne découle de ces hashes locaux.

## Limites et critères de sortie

L'admission 60/minute et la cadence navigateur 1,1 seconde ne promettent pas
60 œuvres hydratées par minute. Les cadences fournisseurs restent inchangées.
La pagination est bornée à quatre pages par alias et vingt secondes partagées;
ses curseurs ne sont pas persistés entre baux. Sous contention, une recherche
peut recommencer; une borne structurelle consomme désormais un essai et finit
en échec contrôlé, pas en faux `NOT_FOUND`. Le secours Discovery quotidien
n'est pas une garantie de reprise immédiate lors d'une perte totale de Queue.

La configuration Wrangler des consommateurs est inchangée par rapport au
dernier `main` publié. Le déploiement Worker la réapplique néanmoins; le plan
inclut maintenant l'inventaire Queue. Cet inventaire ne certifie pas les
réglages distants ni l'abonnement du compte, et aucune modification tarifaire
n'est autorisée par la livraison.

La lecture de la révision Deno n'est pas encore authentifiée : ni les statuts
GitHub disponibles ni `/healthz` ne donnent le SHA routé en production ou une
preuve KV. L'interface Deno demande une connexion. Les treize tests locaux du
correctif anti-rejeu ne doivent pas être présentés comme son déploiement.

La certification distante requiert encore les canaris anime et manga neufs
`MISS → PENDING → VERIFIED`, leurs compteurs fournisseurs/D1/Queue, puis un
petit lot installé et la copie des 1 522 favoris, avec mise à jour conservant
l'identité et redémarrages du service worker et du navigateur. L'export privé
contient bien 1 522 favoris importables; il n'a pas été publié. Les 39
exclusions structurelles restent hors des réparations d'identité prouvées.

Les admissions historiques `FAILED` ne sont pas réarmées par cet audit. Toute
opération directe sur celles-ci ou publication R2 hors du workflow automatique
attend son plan frais, ses cibles exactes et la confirmation immédiate prévue
par la doctrine. Le pointeur public n'avance qu'après vérification des deux
archives téléchargées.
