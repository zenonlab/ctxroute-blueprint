# ADR 0013 — Surveillance des sources privées par extension

- Statut : accepté
- Date : 2026-08-02

## Objectif

Surveiller une page privée ou authentifiée sans transmettre cookies ou session au serveur et sans promettre une disponibilité continue quand Chrome ou l'appareil est arrêté.

## Décision

Une cible `extension_private` est vérifiée exclusivement par une installation appairée disposant de la permission d'hôte explicite. L'API stocke la planification et les résultats minimaux ; elle ne reçoit jamais cookie, HTML complet ou secret du site.

Le service worker de l'extension utilise une alarme coarse nommée pour demander au serveur les vérifications à échéance ; il ne crée pas une alarme durable par œuvre. Il recrée cette alarme à chaque démarrage. Comme une alarme ne réveille pas une machine endormie et peut être retardée, ce mode est explicitement **best effort** : une échéance manquée est examinée au prochain réveil et l'interface affiche l'âge, l'état de l'appareil et `STALE_DEVICE_OFFLINE` au-delà du seuil configuré.

Deux modes privés sont distingués :

1. `extension_page_observation` : le content script inspecte une page déjà ouverte par l'utilisateur, dans sa session normale ;
2. `extension_fetch` : le service worker effectue un fetch uniquement si le connecteur du site a prouvé sur tests que l'authentification et les règles de cookies du navigateur le permettent.

FavLib ne demande pas la permission `cookies`, ne lit ni n'exporte les cookies, et n'ouvre pas silencieusement d'onglet caché. Si aucun onglet compatible n'est ouvert et que `extension_fetch` n'est pas validé, la cible passe à `WAITING_FOR_VISIT`. Ce cas n'est jamais présenté comme une vérification réussie ou une absence de nouveauté.

## Attribution à une installation

- chaque cible possède un `owner_user_id` et une liste d'installations autorisées ;
- une seule installation détient un lease serveur court pour un cycle donné ;
- le lease est acquis avec `(source_target_id, due_bucket, connector_version)` ;
- une autre installation du même utilisateur peut reprendre après expiration ;
- aucune installation d'un autre utilisateur ne voit la cible, son URL ou ses preuves ;
- révocation, déconnexion ou retrait de permission invalide immédiatement son éligibilité.

## Protocole hors ligne et idempotence

```text
API fournit les échéances autorisées
  → extension acquiert un lease court
  → alarme ou réveil déclenche inspect/check local
  → résultat minimal entre dans chrome.storage.local
  → upload avec client_check_id idempotent
  → API acquitte ; l'extension purge l'élément local
```

Un résultat contient uniquement cible opaque, version du connecteur, identité structurée des sorties, origines minimales, horodatage, statut et preuves normalisées. La file possède taille et durée maximales ; les plus vieux éléments expirés deviennent un diagnostic, jamais une fausse absence de sortie.

## Permissions et cycle de vie

Épingler une cible privée ouvre une demande de permission explicite pour son origine. Refus ou retrait conserve la source comme non surveillable et visible avec diagnostic. Retirer le dernier favori désactive abonnement, alarmes, leases et données personnelles de planification. Une migration de domaine exige une nouvelle permission ; elle n'est jamais élargie silencieusement.

## Santé et interface

Les états distinguent au minimum : `HEALTHY`, `DEVICE_OFFLINE`, `PERMISSION_MISSING`, `WAITING_FOR_VISIT`, `AUTH_REQUIRED`, `CHECK_FAILED` et `STALE_DEVICE_OFFLINE`. La dernière observation valide reste affichée avec son âge ; aucun de ces états n'est interprété comme « pas de nouveauté ».

## Tests exigés

- Chrome fermé puis rouvert : alarme recréée, échéance reprise une seule fois ;
- deux installations d'Alice : une seule vérification par bucket, reprise après lease expiré ;
- Alice/Bob : aucune fuite d'URL, résultat, lease ou diagnostic privé ;
- upload rejoué : un seul `check_run` et une seule notification ;
- permission retirée, appareil hors ligne ou authentification expirée : état explicite, dernier snapshot préservé ;
- page authentifiée sans onglet et sans fetch validé : `WAITING_FOR_VISIT`, aucun snapshot vide ;
- dernier favori retiré : alarmes et surveillance personnelle désactivées.

## Conséquences

Les sources privées deviennent surveillables sans partage de session, avec une fiabilité honnête et observable. La surveillance réellement continue d'une source authentifiée nécessiterait ultérieurement un agent local toujours allumé et un ADR séparé.
