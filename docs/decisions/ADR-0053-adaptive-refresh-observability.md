---
scope:
  - apps/worker/src/diagnostics.ts
  - apps/worker/src/diagnostics.test.ts
  - apps/worker/src/operational-metrics.ts
  - apps/worker/src/operational-metrics.test.ts
  - apps/worker/src/native-collectors.ts
  - apps/worker/src/native-collectors.test.ts
  - apps/worker/src/catalogue/public-discovery-routes.ts
  - apps/worker/src/catalogue/public-discovery-routes.test.ts
  - scripts/infra/manga-canary.mjs
  - scripts/infra/manga-canary.test.mjs
  - docs/operations/cloudflare.md
  - docs/architecture/src/agenda-release.dataflow.json
  - docs/architecture/src/public-discovery.dataflow.json
  - docs/architecture/src/adaptive-public-refresh.dataflow.json
  - docs/architecture/src/adaptive-public-refresh.architecture.json
  - docs/architecture/src/public-pipeline.architecture.json
review: on-change
revised: true
---

# ADR-0053 — Mesurer le rafraîchissement adaptatif sans identité

- Status: accepted
- Date: 2026-09-16
- Revised: 2026-09-23

## Contexte

Les budgets Agenda, Discovery et réhydratation doivent être vérifiables en
requêtes HTTP réelles et en lignes D1. Persister ces compteurs dans D1 ferait
cependant d’une lecture publique ordinaire une écriture et augmenterait la
charge que la mesure cherche à contrôler.

## Décision

Émettre un événement applicatif `worker.cost` à schéma fermé pour chaque
traitement Queue, comme le diagnostic de disposition de l’ADR-0052. Les
événements de lecture et d’admission HTTP restent soumis au verrou
`TOBIRINK_WORKER_DIAGNOSTICS=worker-v1`. Un événement de traitement
contient uniquement la tâche, un fournisseur borné ou `mixed`, les requêtes et
pages HTTP, les résultats acceptés, l’issue `changed`, `unchanged`,
`deduplicated`, `backoff` ou `failed`, la durée bornée, les retries et les
lignes D1 lues ou écrites. Les admissions et lectures publiques ajoutent
seulement leurs compteurs agrégés de HIT, MISS, déduplication ou réhydratation.

Les traitements Queue ajoutent `providerTransportDurationMs`, durée cumulée
entre invocation et résolution ou rejet du transport, bornée à une heure par
événement. Elle inclut le passage gateway éventuel, mais ni la lecture ultérieure
du corps ni le matching; des appels parallèles peuvent dépasser la durée murale
du traitement. `provider429s` compte les réponses HTTP 429,
`providerHttpErrors` les réponses HTTP de statut au moins 400 (429 inclus),
et `providerNetworkErrors` les rejets du transport, y compris timeout ou échec
réseau. Les réponses et exceptions sont propagées sans modification. Seuls les
endpoints fournisseurs connus alimentent ces compteurs; les métriques déjà
acquises restent disponibles en cas d’échec ultérieur du collecteur.

Avant émission, le schéma de `worker.cost` valide les enums et les nombres
finis, entiers et non négatifs, puis retire tout champ non déclaré. Les champs
transport sont optionnels pour les événements HTTP sans appel fournisseur;
aucune URL, aucun corps et aucun message d’erreur n’est sérialisé pour les
calculer. Un événement invalide est omis sans modifier l’issue métier.

Le canari de livraison active facultativement `--observe` sur la CI POSIX pour ouvrir un
`wrangler tail --format json --search worker.cost` avant les deux admissions
fraîches. Le wrapper ne conserve ni n’émet les logs bruts, ignore stderr et
désactive leur écriture Wrangler sur disque. Il valide les événements, ne
résume que les tâches Discovery et borne le flux reçu à 1 Mio, la fenêtre à
24 minutes et la fermeture du groupe enfant créé à trois secondes. Tout
échec du tail, flux invalide ou incomplet, absence d’événement ou absence
d’appel fournisseur interdit une certification verte. La fin du canari,
son échec ou une interruption ferme uniquement le groupe npm/Wrangler créé.

Le format JSON de Wrangler ne fournit pas de signal de connexion prêt : les
trois secondes de stabilisation avant le canari ne prouvent pas sa connexion.
Cinq secondes de drainage final laissent arriver les derniers événements.
Le résumé porte sur le trafic Discovery de cette fenêtre, éventuellement
concurrent et échantillonné par Cloudflare; ce n’est ni une attribution aux
deux œuvres ni une mesure exacte de leur coût individuel. Aucun identifiant
de corrélation, titre ou URL n’est ajouté. Sans `--observe`, le canari garde
son comportement HTTP seul et ne prétend pas mesurer les fournisseurs.

Compter les appels au point où le transport reçoit l’URL fournisseur, avant la
sélection du chemin direct ou gateway. Pour Agenda, incrémenter séparément
`pagesRequested` à chaque page effectivement demandée; Discovery publie zéro
page tant qu’il n’expose pas de pagination. Ne jamais dériver un compteur de
l’autre. Compter D1 uniquement depuis
`D1Result.meta.rows_read` et `rows_written`; l’adaptateur d’observation délègue
la requête originale et n’inspecte ni SQL lié, ni paramètres, ni résultats.

Construire les compteurs journaliers dans Cloudflare Logs en sommant les champs
de `worker.cost`. Ne créer ni table D1, ni Analytics Engine, ni identifiant de
cardinalité. Les événements excluent titre, empreinte, référence d’œuvre, URL,
IP, payload fournisseur, secret et identifiant d’installation.

Les tâches `agenda-admission` et `agenda-recovery` émettent leurs propres coûts,
y compris lors d'un échec R2 ou Queue. Chaque appel R2 est compté avant son
exécution; `queueSends` compte les tentatives et `queueFailures` leurs échecs.
La collecte n'inclut pas ces événements dans son total. Une reprise au plus par
lot Queue évite de scanner plusieurs fois les mêmes signaux. Une interruption
du scan legacy conserve son checkpoint; un scan tronqué émet une
continuation `agenda-recovery` même si les vingt premiers signaux sont terminés.
Les erreurs avant
le claim et après la publication conservent les compteurs déjà accumulés.
Une attente Agenda supérieure à huit jours émet `agenda-recovery-overdue`;
un échec de reprise émet `agenda-recovery-failed`. Ces codes fermés ne portent
aucune date ni identité. Ils rendent le défaut observable au prochain réveil;
ils ne créent pas un service d'alerte externe et ne garantissent aucun réveil
pendant une interruption globale de Queue et du cron.

## Conséquences

Les coûts sont comparables aux métriques natives D1 et aux quotas HTTP sans
écriture sur cache hit. La panne ou la désactivation du diagnostic ne change
aucun résultat produit. Les journaux ne permettent pas de reconstituer une
bibliothèque ni une œuvre demandée; ils permettent seulement des sommes
quotidiennes par tâche, fournisseur et issue.
