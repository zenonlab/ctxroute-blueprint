# ADR 0006 — File de jobs PostgreSQL

- Statut : accepté
- Date : 2026-08-02

## Décision

FavLib utilise [Graphile Worker](https://github.com/graphile/worker) comme file de jobs persistante dans PostgreSQL.

Les tâches principales sont :

- planification d'une cible ;
- vérification d'une source ;
- traitement d'un résultat ;
- fan-out vers les abonnements ;
- notification ou digest ;
- purge et maintenance.

Les jobs portent une clé idempotente métier. Les verrous de cible et limites de domaine sont imposés en plus des garanties de la file. Une transaction base crée ensemble sorties et événements personnels avant l'acquittement du job.

Redis et pg-boss ne font pas partie de la V1. Leur ajout ou remplacement exige un ADR et un plan de migration.

## Conséquences

Le déploiement local conserve un seul moteur de données. Les jobs survivent aux redémarrages et restent inspectables avec les outils administrateur FavLib.
