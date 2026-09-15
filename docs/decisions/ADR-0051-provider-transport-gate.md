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

La gate `PROVIDER_TRANSPORT_MODE` accepte seulement `direct` ou `gateway` et
échoue fermée pour toute autre valeur. `direct` est la valeur versionnée par
défaut et n’exige ni proxy ni secret. `gateway` exige une origine HTTPS sans
chemin ni credentials et un secret HMAC de 32 à 256 octets. Changer de
passerelle modifie seulement ces bindings et repasse par la gate de déploiement
Cloudflare; le consumer et les fournisseurs restent inchangés.

La gate opérationnelle Cloudflare dérive également les deux ressources Queue
du seul `wrangler.jsonc`. Elle expose uniquement les opérations de création
`tobirink-public-discovery` et `tobirink-public-discovery-dlq`, inclut
l'inventaire Queue dans l'empreinte d'inspection et traduit leur création avant
le déploiement Worker. Un nom absent de la configuration, un changement d'état
entre plan et application ou une cible absente de l'allowlist invalide le plan.

Les deux adaptateurs limitent les cibles aux opérations exactes AniList,
MangaUpdates, MangaDex et Kitsu. La couche HTTP portable conserve un timeout,
interdit les redirections et borne les réponses à 512 Kio. Le client gateway
borne son enveloppe à 64 Kio et la signe; aucun serveur proxy, registre de nonce
ou endpoint public générique n’est conservé dans ce dépôt.

Le transport direct identifie les requêtes AniList Discovery avec la même
origine, le même référent et le même user-agent produit que la collecte Agenda.
Ces en-têtes ne portent ni secret ni donnée de bibliothèque; ils évitent qu'un
client serveur anonyme soit confondu avec un trafic générique.

Deno Deploy est retenu comme premier candidat gratuit pour une passerelle
séparée : ses règles autorisent explicitement une API qui interroge une API
externe et un reverse proxy, contrairement à un forward proxy générique. La
passerelle utilise une base Deno KV attachée pour réclamer chaque nonce par
transaction atomique avec expiration. Vercel Hobby reste un candidat de repli,
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
par une passerelle sans modifier le flux métier. La gate rend la configuration
invalide visible au démarrage du traitement au lieu de basculer silencieusement.
Le retest distant du 15 septembre 2026 confirme cinq réponses AniList HTTP 403
depuis l’adaptateur direct Cloudflare. La gateway Deno répond 200 pour AniList
et MangaUpdates, mène Discovery à `VERIFIED` et produit une génération Agenda
active de 711 événements. `gateway` est donc le mode de production; `direct`
reste un rollback explicite sans bascule silencieuse.

Sources de décision consultées le 15 septembre 2026 :

- https://docs.deno.com/deploy/usage/
- https://docs.deno.com/deploy/reference/deno_kv/
- https://docs.deno.com/deploy/kv/transactions/
- https://vercel.com/docs/plans/hobby
- https://render.com/docs/free
