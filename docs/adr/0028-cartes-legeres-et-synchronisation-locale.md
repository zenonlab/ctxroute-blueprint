# ADR 0028 — Cartes légères et synchronisation locale

## Décision

Les grilles utilisent une projection stricte de carte et chargent la fiche personnelle complète au premier clic. La réponse est conservée en mémoire pendant la page. Les lectures personnelles sont réutilisables trente secondes par le navigateur, sans actualisation automatique.

Le scan périodique de l’extension compare d’abord l’arbre Chrome à l’état persistant. Sans événement local ni file hors ligne, il se termine sans requête réseau. Le contrôle serveur regroupant configuration, propositions et reçu d’inventaire est réservé au démarrage, à l’appairage, à une reprise réseau ou à une action administrative.

## Compatibilité

`GET /api/v1/library` et les anciens endpoints de diagnostic/réconciliation restent disponibles. `GET /api/v1/library/cards`, `GET /api/v1/home`, `GET /api/v1/header-summary` et `GET /api/v1/extension/control` portent le nouveau flux. Le détail reste autorisé par utilisateur et conserve données brutes et provenance.
