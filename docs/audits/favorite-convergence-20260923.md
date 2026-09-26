# Convergence des favoris — certification du 23 septembre 2026

## État

Premier lot corrigé, vérifié et déployé par CI depuis `0fb15bd`; canaris neufs
anime et manga réussis. Deux limites D1 supplémentaires identifiées pendant
la mesure de production sont corrigées et vérifiées localement, avant nouvelle
livraison. La convergence complète du profil réel reste non acquise. Extension
et pointeur public `1.0.44`; les archives ont été publiées et relues par le run
protégé `36253775721` après deux nouveaux canaris fournisseur VERIFIED.
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
| Publication, 582 œuvres et 2 328 titres canoniques | 151 379 lignes D1 lues | 111 |
| Rejeu de cette publication | 58 231 lignes D1 lues | 51 |
| Conflit de titre canonique, même catalogue | 58 118 lignes D1 lues | 41 |
| Réparation de 1 522 sources en attente | 16 transactions et 1 522 relectures individuelles | 16 pages, une lecture Library, zéro transaction/relecture individuelle |

Les écritures restent zéro pour le réveil vide, vingt pour les quatre claims,
39 pour la publication et zéro pour son rejeu ou le conflit. Ces
mesures portent sur des fixtures workerd, pas sur une facture Cloudflare ni
sur une limite universelle : les requêtes parcourent encore les actifs utiles.

## Validations

`npm run verify` passe entièrement, notamment les types, suites workspace,
tests Deno, contrats IndexedDB dans Chromium, tests infra et gouvernance,
budgets performance, audit de dépendances et diagrammes. L'audit npm ne signale
aucune vulnérabilité. Les tests Web E2E donnent neuf succès et un test réseau
public facultatif ignoré; cette omission n'est pas une preuve de production.
Une seconde exécution complète après les contrôles de livraison est verte;
la suite infra contient désormais 71 tests, tous réussis. Une troisième
vérification complète passe après les corrections de coût et de budget D1,
avec 170 tests Worker et les contrôles de livraison optionnelle R2.

Suites directement concernées : application 430, extension 170, adaptateurs
navigateur 106, composant Discovery 96, Worker 170 et gateway Deno 13 tests.
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

Le même parcours a ensuite conservé les 1 522 favoris issus de l'export privé
après mise à jour, arrêt du service worker, redémarrage du navigateur et reprise
du même profil temporaire. Le premier budget de 240 secondes termine
explicitement incomplet; la reprise atteint zéro source en traitement après
163 secondes supplémentaires : 1 483 erreurs réseau attendues hors ligne et
39 exclusions `IDENTITY_MISSING`. Les 1 483 entrées Library sont provisoires,
avec zéro Work résolu. Ce test vérifie la conservation et la poursuite, pas la
convergence en ligne ni la copie de la base privée originale.

Les canaris protégés exigent maintenant une observation bornée des métriques
`worker.cost`, sans conservation des événements bruts. Une fenêtre vide ou
sans appel fournisseur reste en échec. Ces agrégats décrivent le trafic de la
fenêtre, pas le coût attribuable individuellement à chaque canari.

L'audit des 1,5 à 1,8 million de lectures D1 a distingué les lignes parcourues
des appels SQL : la fenêtre bornée comptait environ 14 700 requêtes, soit une
moyenne d'environ 120 lignes examinées par requête. Les diagnostics CI ne
représentaient que quelques milliers de lignes. La pression venait donc des
scans historiques, des réveils Queue/cron et des routes publiques `GET` et
`lookup`, qui n'étaient pas limitées par IP et pouvaient être interrogées par
un polling ou un crawler sans admission. Le regroupement `readMany` est déjà
déployé ; les deux routes de lecture utilisent désormais le bucket séparé
`read:<ip>` et renvoient `429` avant D1. Régression Worker : 25/25 tests ciblés
et typecheck vert.

Les workflows protégés `35863844924` et `35864161437` ont réussi. Le second a
déployé la version Worker `7c5c56a4-38da-4781-a6a8-5f548f417624` et vérifié deux
clés neuves `MISS → PENDING → VERIFIED` : anime en 47 174 ms, manga en 91 310 ms.
La fenêtre observée de 147 471 ms contient 24 appels fournisseur, deux résultats
acceptés, quatre émissions Queue, aucune erreur Queue, aucun 429 ni échec
HTTP/réseau fournisseur. Ses 106 769 lectures et 90 écritures D1 incluent le
trafic concurrent; elles motivent l'examen complémentaire du coût de publication.

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

La configuration Wrangler des consommateurs est inchangée. L'interface
Cloudflare authentifiée confirme le plan Workers Free, la Queue active et les
réglages distants : lot de cinq, attente maximale de dix secondes, concurrence
deux, huit retries et DLQ configurée. Le relevé ponctuel affiche 1 102 opérations
Queue sur 10 000 dans la journée. Les métriques D1 sur 24 heures indiquent
3,66 millions de lectures et 18,58 milliers d'écritures; cette fenêtre glissante
ne mesure pas le budget journalier UTC restant. Une seconde lecture, bornée
au 23 septembre de 00:00 à 13:35 UTC, donne environ 1,77 million de lectures
et 16,27 milliers d'écritures pour cette base. Ce relevé reste arrondi et ne
couvre pas d'autres bases éventuelles. Aucun abonnement ni réglage distant
n'a été changé.

Les principales jointures de garde canonique ont été corrigées dans `9ecc5db` :
elles recherchent désormais les titres proposés par leur clé primaire complète,
sans migration ni retrait de garde d'identité. Un autre test, avec le vrai consumer
et D1 local soumis à une limite de 50 appels, reproduisait un dépassement au
51e appel pour cinq résolutions simples. Ces demandes convergent désormais
sur deux réveils de 45 puis 14 appels D1, avec exactement dix HTTP et reports
sans consommation d'essai ni recherche répétée.
Les tests incluent les opérations encore en vol après deadline, le report de
refresh, la pagination coûteuse et huit essais conduisant à `UNAVAILABLE`
sans faux `NOT_FOUND`. Un succès publié avant une erreur ultérieure reste
compté dans les métriques. Les canaris précédents ne suffisent pas à certifier
ces corrections nouvelles : leur redéploiement et mesure précèdent le lot en ligne.

Le traitement de signaux mixtes est également couvert : le premier groupe
valide s'exécute seul, les doublons sont regroupés et les autres groupes sont
renvoyés durablement avant acquittement. Une panne de renvoi conserve un signal
en retry. Cela évite de cumuler Agenda et Discovery dans la même invocation;
le cron hebdomadaire ne change pas. Les renvois sont visibles comme
`ack-forwarded`; ils ne sont pas inclus dans les compteurs `worker.cost` des
collecteurs, qui ne constituent donc pas un total absolu des opérations Queue.

La lecture de la révision Deno n'est pas encore authentifiée : ni les statuts
GitHub disponibles ni `/healthz` ne donnent le SHA routé en production ou une
preuve KV. L'interface Deno demande une connexion. Les treize tests locaux du
correctif anti-rejeu ne doivent pas être présentés comme son déploiement.

La certification distante requiert encore une nouvelle mesure des canaris
après les deux corrections D1, puis un petit lot installé et la copie des
1 522 favoris en ligne, avec mise à jour conservant l'identité et redémarrages
du service worker et du navigateur. L'export privé
contient bien 1 522 favoris importables; il n'a pas été publié. Les 39
exclusions structurelles restent hors des réparations d'identité prouvées.

Les admissions historiques `FAILED` ne sont pas réarmées par cet audit. Toute
opération directe sur celles-ci ou publication R2 hors du workflow automatique
attend son plan frais, ses cibles exactes et la confirmation immédiate prévue
par la doctrine. Le pointeur public n'avance qu'après vérification des deux
archives téléchargées.

La voie CI optionnelle de publication existe désormais : désactivée sur les
pushes, elle exige un dispatch sur `main` avec canaris réussis, puis un plan
R2 séparé limité aux deux objets candidats. Les SHA-256 et tailles des octets
locaux et publics doivent correspondre. Une publication partielle conserve
l'objet réussi et le pointeur précédent; la reprise saute l'objet identique.
Les deux actions GitHub sont figées aux commits de leurs versions v5 actuelles,
sans changement de permission. Cette voie n'a pas encore été déclenchée.

Un audit complémentaire a trouvé puis corrigé le dernier N+1 de lecture : le
lookup public de 50 clés appelait auparavant `read()` par clé, soit 100 à 150
RPC D1 avec les gardes et les métadonnées. `readMany` joint maintenant les
quatre colonnes d’identité dans une requête JSON1 groupée; la régression Worker
de 50 clés reste dans le budget de lecture nominal. Les transitions expirées
sont réévaluées uniquement pour les lignes qui atteignent effectivement la
borne d’essais.
Après le déploiement `321cee3`, le canari frais a de nouveau traversé les deux
médias : anime en 31,5 s et manga en 30,8 s, quatre appels fournisseur, zéro
429/erreur HTTP-réseau, 4 535 lectures D1, 31 écritures et deux émissions
Queue. Un essai installé en ligne limité à huit favoris avec la candidate seule
`1.0.44` a conservé les huit sources et la Library après les redémarrages, mais
les huit clés sont restées `PROVIDER_UNAVAILABLE` sans admission ni progression
à 33 s. Il a été arrêté selon la borne d'arrêt; ce résultat ne certifie ni la
convergence ni le plein profil et aucune reprise historique n'a été lancée.
