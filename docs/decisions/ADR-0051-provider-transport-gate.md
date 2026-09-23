---
scope:
  - packages/public-discovery/src/provider-transport.ts
  - packages/public-discovery/src/provider-http.ts
  - apps/worker/src/provider-transport-adapter.ts
  - apps/worker/src/provider-transport-adapter.test.ts
  - apps/worker/src/native-collectors.ts
  - apps/worker/wrangler.jsonc
  - apps/provider-gateway/package.json
  - apps/provider-gateway/src/index.ts
  - apps/provider-gateway/src/index.test.ts
  - scripts/infra/provider-gateway-driver.mjs
  - scripts/infra/provider-gateway-driver.test.mjs
  - docs/architecture/src/public-discovery.dataflow.json
  - docs/architecture/src/agenda-release.dataflow.json
  - docs/architecture/src/public-pipeline.architecture.json
review: on-change
revised: true
---

# ADR-0051 — Isoler et sélectionner le transport fournisseur

- Status: accepted
- Date: 2026-09-15
- Revised: 2026-09-23

## Contexte

Le premier candidat Queue composait directement un client de proxy et publiait
également le serveur proxy dans le package portable. Retirer ou remplacer cet
hébergeur obligeait donc à toucher au consumer Discovery et Agenda. Le chemin
direct Cloudflare est gratuit, mais un essai AniList antérieur a répondu HTTP
403 depuis cet egress; son fonctionnement ne peut pas être supposé sans test
réel. Cette décision remplace les paragraphes de composition proxy des
ADR-0045 et ADR-0047; leurs constats de déploiement antérieurs restent des
preuves historiques, pas la composition cible.

## Décision

Définir `ProviderTransportPort` dans le package portable et placer les
implémentations réseau dans la composition Worker, comme le port D1 sépare le
métier de son adaptateur Cloudflare. Les résolveurs et collecteurs reçoivent
uniquement la fonction liée à ce port.

La gate `PROVIDER_TRANSPORT_MODE` accepte `direct`, `gateway` ou
`selective-gateway` et
échoue fermée pour toute autre valeur. `direct` est la valeur versionnée par
défaut et n’exige ni proxy ni secret. `gateway` exige une origine HTTPS sans
chemin ni credentials et un secret HMAC de 32 à 256 octets.
`selective-gateway` applique la décision à chaque endpoint : AniList et
MangaUpdates (`/v1/series/search`, `/v1/series/{id}` et
`/v1/releases/search`) utilisent Deno; MangaDex et Kitsu restent directs. Changer de
passerelle modifie seulement ces bindings et repasse par la gate de déploiement
Cloudflare; le consumer et les fournisseurs restent inchangés.

La signature Cloudflare utilise toujours une seule clé courante. Pour une
rotation sans interruption, Deno accepte temporairement cette clé courante et
une seule clé précédente distincte, toutes deux bornées à 32–256 octets. Il
calcule les deux signatures attendues avant de décider, conserve le nonce
atomique commun et échoue fermé pour une liste vide, une clé invalide, un
doublon ou plus de deux clés. La gate Deno inventorie les noms de variables
sans leur valeur et sépare l’ajout de la précédente, la mise à jour de la
courante et la suppression finale. Elle normalise les réponses historiques
`name`/`secret` et actuelles `key`/`isSecret` sans conserver de valeur; une
forme mixte, ambiguë ou inconnue échoue avant la planification. La précédente est installée avant la mise à
jour courante; sa suppression et chaque déploiement restent des mutations
fournisseur approuvées séparément.

La CLI Deno exige une valeur positionnelle pour `env add` et
`env update-value`, ce qui placerait un secret dans les arguments du processus.
La gate utilise donc `env load` avec exactement une variable autorisée dans un
répertoire temporaire privé et un fichier créé en mode `0600`. La valeur reste
absente des arguments et des erreurs propagées; le répertoire est supprimé en
`finally`, après succès comme après échec. Les opérations et plans conservent
leurs cibles unitaires : ce détail de transport ne permet ni secret arbitraire
ni mutation supplémentaire.

La gate opérationnelle Cloudflare dérive également les deux ressources Queue
du seul `wrangler.jsonc`. Elle expose uniquement les opérations de création
`tobirink-public-discovery` et `tobirink-public-discovery-dlq`, inclut
l'inventaire Queue dans l'empreinte d'inspection et traduit leur création avant
le déploiement Worker. Un nom absent de la configuration, un changement d'état
entre plan et application ou une cible absente de l'allowlist invalide le plan.

Les adaptateurs limitent les cibles aux opérations exactes AniList,
MangaUpdates, MangaDex et Kitsu. En mode sélectif, la gateway réduit sa propre
allowlist aux seuls endpoints qui doivent la traverser. La couche HTTP portable conserve un timeout,
interdit les redirections et borne les réponses à 512 Kio. Le client gateway
borne son enveloppe à 64 Kio et la signe; aucun serveur proxy, registre de nonce
ou endpoint public générique n’est conservé dans ce dépôt.

Le transport direct identifie les requêtes AniList Discovery avec la même
origine, le même référent et le même user-agent produit que la collecte Agenda.
Ces en-têtes ne portent ni secret ni donnée de bibliothèque; ils évitent qu'un
client serveur anonyme soit confondu avec un trafic générique.

Le gateway distingue les échecs de confiance avant upstream des réponses
upstream. Une signature absente, malformée ou invalide répond
`401 invalid-signature` et journalise `auth_failure_layer=gateway`; aucun appel
fournisseur n'a alors lieu. Une réponse AniList `401` répond
`401 anilist-auth-failed` et journalise `auth_failure_layer=upstream` avec le
fournisseur `anilist` et le statut upstream. Le Worker reçoit donc un code
stable sans devoir connaître le secret ni interpréter le corps du fournisseur.

Les requêtes Discovery AniList ne portent pas de jeton OAuth. La documentation
officielle AniList indique que les données publiques ne requièrent pas OAuth;
aucun `Authorization` n'est donc ajouté par défaut et aucun token AniList n'est
introduit dans le Worker ou dans ce dépôt. Une future fonctionnalité de données
privées devra recevoir une décision et un secret distincts côté gateway.

Chaque requête du gateway émet une métrique structurée bornée avec
`gateway_request_id`, `provider`, `upstream_status`, `status`, `duration_ms`,
`auth_failure_layer` et `retries`. Le même identifiant est renvoyé dans
`X-Tobirink-Gateway-Request-Id`. La valeur `retries` est zéro dans le gateway;
les reprises Queue sont mesurées par le consumer Worker. Les événements
excluent titre recherché, fingerprint, URL complète, payload, token et secret.

Deno Deploy est retenu comme premier candidat gratuit pour une passerelle
séparée : ses règles autorisent explicitement une API qui interroge une API
externe et un reverse proxy, contrairement à un forward proxy générique. La
passerelle utilise une base Deno KV attachée pour réclamer chaque nonce par
transaction atomique avec expiration. L'expiration du nonce couvre toute la fenêtre de validité de
l'enveloppe, y compris une horloge émettrice en avance et la borne inclusive :
`max(réception, issuedAt) + 60 000 ms + 1 ms`. Une requête encore valide ne peut
donc pas retrouver un nonce expiré. Cette correction ne change ni le contrat
de transport ni la topologie des diagrammes existants. Le serveur HTTP démarre avant d’attendre
la connexion KV : `/healthz` reste disponible pendant le warm-up, tandis que
seul le trafic signé attend la promesse KV et échoue fermé en 503 si elle est
indisponible. Vercel Hobby reste un candidat de repli,
mais son offre gratuite est limitée aux usages personnels non commerciaux.
Render gratuit est exclu car sa mise en veille peut ajouter environ une minute
au premier appel. Une passerelle publique ouverte est exclue : elle ne fournit
ni identité, ni confidentialité, ni disponibilité contrôlable.

Aucun candidat n’est déclaré compatible avant un smoke test signé vers AniList
et MangaUpdates, puis un test Discovery `PENDING` jusqu’à l’état terminal et
une collecte Agenda complète. Le déploiement Deno, sa base KV et son secret
passent exclusivement par la gate fournisseur dédiée.

## Conséquences

Le mode direct peut être essayé sans coût ni nouvelle ressource, puis remplacé
par une passerelle complète ou sélective sans modifier le flux métier. La gate rend la configuration
invalide visible au démarrage du traitement au lieu de basculer silencieusement.
Le retest distant du 15 septembre 2026 confirme cinq réponses AniList HTTP 403
depuis l’adaptateur direct Cloudflare. La gateway Deno répond 200 pour AniList
et MangaUpdates, mène Discovery à `VERIFIED` et produit une génération Agenda
active de 711 événements. Un test ultérieur a montré que MangaUpdates Discovery
retourne HTTP 403 en direct. La tentative de laisser seulement MangaUpdates
Agenda en direct a ensuite échoué en production avec
`agenda-collection-incomplete`, tandis que les cinq pages AniList traversaient
la gateway en HTTP 200; tous les endpoints MangaUpdates repassent donc par Deno.
`selective-gateway` est donc le mode de production; `gateway` reste le rollback
sûr et `direct` un diagnostic explicite sans bascule silencieuse.

Sources de décision consultées le 15 septembre 2026 :

- https://docs.deno.com/deploy/usage/
- https://docs.deno.com/deploy/reference/deno_kv/
- https://docs.deno.com/deploy/kv/transactions/
- https://docs.deno.com/runtime/reference/cli/deploy/
- https://anilist.gitbook.io/anilist-apiv2-docs/docs/guide/migration/version-1
- https://vercel.com/docs/plans/hobby
- https://render.com/docs/free
