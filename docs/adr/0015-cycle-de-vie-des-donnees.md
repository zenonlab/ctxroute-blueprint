# ADR 0015 — Cycle de vie, export et suppression des données

## Objectif

Définir ce que FavLib conserve, pendant combien de temps et ce qui arrive lors du retrait d'un favori, de la révocation d'un appareil, de la suppression d'un compte ou de la restauration d'une sauvegarde.

## Classes et rétention initiale

| Classe | Rétention V1 | Règle |
|---|---:|---|
| favori actif, bibliothèque, préférences, progression | durée du compte et du favori actif | personnel, exportable et supprimable |
| candidat serveur finalement ignoré | moins de 24 heures | URL lisible exclue des sauvegardes applicatives |
| événement extension acquitté | purge locale sous 7 jours | fingerprints reconstruisibles purgés en priorité |
| HTML tiers brut | non conservé par défaut | extraction normalisée, hash et diagnostic seulement |
| `check_run` et diagnostic normalisé | 30 jours | URL sensible tronquée/hachée ; résultat privé non mutualisé |
| inbox lue | 180 jours | événement personnel ; non lu conservé jusqu'à action ou suppression du compte |
| journal de sécurité | 90 jours | aucune URL favorite, secret ou donnée de contenu |
| export personnel généré | 24 heures maximum | fichier chiffré ou téléchargement authentifié à usage unique |
| métadonnée catalogue | selon politique de provenance | supprimée/isolée si la politique n'autorise plus sa rétention |
| sauvegarde | 7 quotidiennes, 4 hebdomadaires, 6 mensuelles | chiffrée, stockage distinct, expiration automatique vérifiée |

Toute nouvelle table reçoit avant migration : propriétaire ou scope partagé, finalité, provenance éventuelle, exportabilité, rétention, stratégie de purge et comportement de restauration.

## Retrait d'un favori et révocation d'un appareil

Retirer le dernier favori personnel d'une œuvre désactive atomiquement abonnement, préférences de source, planification privée et notifications futures. La progression peut être conservée dans l'historique personnel jusqu'à suppression explicite du compte ou de l'œuvre ; elle ne maintient aucune surveillance.

Révoquer une installation invalide immédiatement son secret et ses leases. Les événements arrivant ensuite sont refusés. Les favoris restent rattachés au compte mais passent en état appareil révoqué jusqu'à une nouvelle installation ou leur suppression explicite ; FavLib ne prétend pas qu'ils sont encore surveillés.

## Export personnel

L'export est un format JSON versionné avec manifest et checksum. Il contient comptes sans hash de mot de passe, appareils sans secret, favoris personnels, rattachements, progression, préférences, inbox et décisions personnelles de matching. Il exclut : sessions, jetons, codes d'appairage, secrets, journaux de sécurité d'autres acteurs, métadonnées partagées complètes et données personnelles d'un autre utilisateur.

La génération est asynchrone, bornée, journalisée et soumise à réauthentification récente. Le téléchargement expire sous 24 heures puis l'artefact est supprimé. L'import d'un export n'est pas implicitement promis par la V1 ; une restauration complète utilise la procédure administrateur.

## Suppression d'un compte

1. réauthentification récente et confirmation explicite ;
2. désactivation immédiate du compte, révocation sessions/appareils/invitations et arrêt des jobs personnels ;
3. workflow idempotent supprimant favoris, progression, préférences, inbox, observations privées et URLs personnelles ;
4. conservation uniquement des métadonnées partagées possédant une provenance indépendante autorisée ;
5. rapport sans données personnelles indiquant succès, échecs et date UTC.

Une correction promue vers le catalogue partagé doit perdre son lien lisible vers l'auteur ou être supprimée si elle ne possède aucune preuve indépendante. Une suppression en échec reste visible comme incident et se rejoue ; le compte ne redevient jamais actif automatiquement.

## Sauvegardes et non-résurrection

Les données supprimées peuvent rester chiffrées dans une ancienne sauvegarde jusqu'à l'expiration de sa rétention. Un journal de tombstones opaque `(user_id, deleted_at)` est conservé hors de la base active avec les manifests de sauvegarde pendant au moins la durée de la sauvegarde la plus ancienne plus le RPO.

La commande de restauration applique le journal courant après `pg_restore` et avant de redémarrer l'API. Elle vérifie qu'aucun compte supprimé, secret révoqué ou job personnel associé n'est réactivé. Une perte survenue après la dernière copie externe reste soumise au RPO mesuré et doit être annoncée comme telle, jamais masquée.

## Tests exigés

- export Alice sans secret ni donnée de Bob, manifest/checksum valides et expiration sous 24 heures ;
- retrait du dernier favori : aucune nouvelle surveillance, préférence ou notification ;
- suppression rejouée après crash sans résurrection ni fuite ;
- métadonnée partagée conservée seulement avec provenance indépendante ;
- restauration d'une sauvegarde antérieure à une suppression puis application du tombstone ;
- purge mesurée de chaque classe et échec observable lorsque la purge ne s'exécute pas ;
- dernier administrateur protégé conformément à l'ADR 0014.

## Conséquences

La politique de rétention devient une propriété du schéma et des tests. La Wave 1 prépare les tables, tombstones et commandes administrateur ; les exports/suppressions utilisateur complets sont fermés au plus tard en Wave 9 avant validation V1.
