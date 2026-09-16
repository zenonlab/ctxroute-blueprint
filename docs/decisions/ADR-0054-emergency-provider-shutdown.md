---
scope:
  - apps/worker/wrangler.jsonc
  - docs/operations/cloudflare.md
  - docs/architecture/src/provider-operations.lifecycle.json
  - .project/project-config.json
review: on-change
---

# ADR-0054 — Couper les traitements fournisseur en échec fermé

- Status: accepted
- Date: 2026-09-16

## Contexte

La limite d’écritures D1 a été atteinte avant le déploiement du rafraîchissement
adaptatif. Tant que l’origine de la consommation n’est pas certifiée, conserver
un déclencheur HTTP, Queue ou planifié pourrait continuer à produire des appels
fournisseur ou des écritures distantes.

## Décision

Appliquer une coupure opérationnelle en trois barrières conservatrices. Suspendre
d’abord la livraison de `tobirink-public-discovery` sans purger ses messages.
Retirer ensuite de la configuration Worker le sous-domaine `workers.dev`, la
route `tobirink.com/*` et tous les Cron Triggers. Déployer uniquement ces
triggers; ne pas redéployer le code et ne pas appliquer les migrations D1.
Si la version de Wrangler ignore une liste de routes vide, remplacer les routes
du script par `[]` avec l’endpoint officiel Workers Scripts Routes et vérifier
immédiatement le résultat par une lecture du même endpoint.

Conserver le Worker, sa version active, D1, R2, les deux Queues et leurs
messages. La gateway fournisseur peut rester déployée: sans entrée Worker,
livraison Queue ni cron, elle ne reçoit plus de requête signée issue du produit.
La coupure rend volontairement indisponibles le site, l’API et les téléchargements
servis par le Worker.

La reprise est une opération fournisseur distincte et explicitement approuvée.
Elle restaure une configuration revue, déploie routes et crons, vérifie leur
état et ne reprend la livraison Queue qu’en dernier.

## Conséquences

Aucun traitement Worker ne peut démarrer par HTTP, Queue ou planification, tout
en laissant les données et artefacts récupérables. Les messages suspendus restent
soumis à la rétention Cloudflare. Une restauration accidentelle de la route ou
du cron par un déploiement ultérieur est empêchée par la configuration versionnée
en échec fermé.
