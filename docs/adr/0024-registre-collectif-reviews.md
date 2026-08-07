# ADR 0024 — Registre collectif local des reviews

Statut : accepté — 2026-08-07

## Décision

FavLib partage uniquement les fiches publiques des fournisseurs, jamais les favoris, identités ou votes individuels. Une clé `v1` combine fournisseur, type de média, titre issu du parseur partagé et, pour AniList seulement, une saison accompagnée d’une preuve explicite. Le titre brut et la provenance de saison sont conservés. Un numéro terminal nu ne devient pas une saison.

Les clusters suivent `PROVISIONAL`, `CONFIRMED`, `SUSPENDED`, `DISPUTED` ou `HOMONYM_REQUIRED`. Une fiche et son payload complet sont mis en cache dans `provider_profile`; la couverture est un asset local distinct. Une identité déjà en cache ne déclenche pas d’appel fournisseur. L’enrichissement ultérieur de statut, calendrier et sorties reste indépendant de cette recherche d’identité.

Deux propriétaires actifs distincts choisissant la même fiche dans une époque confirment le cluster. Une résolution automatique ne vote pas. Chaque utilisateur vote au plus une fois par époque et doit conserver le favori actif correspondant. Deux fiches ayant chacune deux voix placent le cluster en `HOMONYM_REQUIRED`. Une troisième fiche n’est qualifiée qu’à deux voix; un choix isolé reste auditable sans déplacer le consensus. Les cartes sont limitées à cinq et les agrégats ne sont révélés qu’après le vote personnel.

Un propriétaire actif peut signaler une résolution une fois par époque avec une raison structurée. Le quorum normal est `max(1, ceil(20 % des propriétaires actifs))`. Après deux suspensions suivies de reconfirmations du même candidat, il devient `max(2, ceil(30 %))`. Une suspension ouvre une nouvelle époque, bloque les futures résolutions automatiques et crée une revalidation facultative pour les propriétaires déjà résolus. Ignorer conserve la décision et ne vote pas; choisir ajoute une voix fraîche sans réécrire la décision historique. Deux nouvelles voix concordantes sont requises. Face à un concurrent qualifié, l’avance doit atteindre le quorum, sinon l’état reste `DISPUTED`.

## Exploitation et anti-abus

« Actif et éligible » signifie : compte actif âgé d’au moins sept jours, extension non révoquée ayant une synchronisation vérifiée, et favori courant `matched` ou `accepted` âgé d’au moins vingt-quatre heures. Cette temporisation empêche de fabriquer un favori après avoir découvert un vote sans interdire définitivement aux propriétaires arrivés après la création du cluster de participer. L’éligibilité est imposée par des fonctions et triggers PostgreSQL, pas seulement par l’API. Les contraintes uniques rendent votes, signalements et revalidations idempotents; les mutations verrouillent le cluster. L’API impose l’appartenance utilisateur et ne retourne que profils publics et agrégats autorisés.

Un propriétaire isolé peut demander une correction personnelle, mais ne suspend jamais seul un consensus collectif. Le quorum effectif est au minimum deux propriétaires éligibles, puis `ceil(20 %)`; après durcissement il est au minimum trois, puis `ceil(30 %)`. Les comptes récents, désactivés, sans synchronisation vérifiée, appareils révoqués et favoris trop récents ne sont comptés ni comme voix ni comme signalements. Une erreur de route ne peut contourner ces règles grâce aux triggers.

Les profils et votes suivent la durée de vie du catalogue local. Une suppression de compte cascade ses votes et signalements personnels; une fiche encore référencée reste protégée. La purge fournisseur supprime d’abord les clusters non référencés et leurs assets conformément à la politique du fournisseur. Sauvegarde et restauration incluent toutes les tables; après restauration, les comptes désactivés et tombstones sont appliqués avant le recalcul des quorums.

L’audit documente, par époque, clé/version, profils, totaux anonymisés, transitions, quorum et raisons structurées. Il n’exporte aucun titre de favori brut hors sauvegarde administrateur. Le backfill crée les clés avec le parseur partagé depuis les reviews existantes, rattache leurs profils sans transformer les anciennes décisions en votes, puis contrôle : taux de cache, appels évités, clusters confirmés/disputés et suspensions.

Un administrateur peut choisir une fiche avec une confiance immédiate. Cette adjudication reste silencieuse dans l’interface ordinaire, est inscrite dans un historique immuable et peut être annulée. Elle ne réécrit aucune décision personnelle. Si au moins deux fiches sont déjà qualifiées, l’état reste `HOMONYM_REQUIRED` malgré l’adjudication : la confiance administrative ne supprime jamais une ambiguïté ni le choix obligatoire entre homonymes.

Un cluster conserve au maximum deux cartes verrouillées et trois propositions parmi les cinq cartes affichées. Une carte se verrouille après deux choix indépendants, sans condition d’ancienneté pour contribuer; l’éligibilité renforcée ne concerne que le consensus automatique et les suspensions. Les verrous sont remplaçables. Leur classement utilise uniquement des preuves locales : adjudication admin, consensus courant, choix distincts de l’époque et historiques, portée dans les reviews en attente et complétude de la fiche locale. La popularité ou l’ordre du fournisseur ne participe jamais à l’identité. Chaque verrouillage ou remplacement est historisé.

Le fournisseur est obligatoire dans chaque input d’identité : `anilist` pour `ANIME`, `mangaupdates` pour `MANGA`, `MANHWA` et `MANHUA`. Une combinaison incohérente est rejetée avec `PROVIDER_MEDIA_TYPE_MISMATCH`; elle n’est jamais corrigée et aucun fallback inter-fournisseur n’existe. Les résultats complets sont sauvegardés puis classés par matching symétrique. Le registre collectif intervient lorsque le fournisseur ne retourne aucune carte pertinente ou qu’une fiche manuelle corrige les propositions. Une mesure d’audience publique du fournisseur peut uniquement départager en dernier ressort des propositions de même utilité pour l’affichage des places libres; elle ne peut ni verrouiller, ni confirmer, ni remplacer une identité.

Le cluster communautaire est exclusivement indexé par la clé issue du titre parsé partagé. Après résolution, l’enrichissement reçoit l’ID fournisseur figé et récupère directement cette fiche. Même lors d’un rafraîchissement forcé, il ne relance aucune découverte par titre et ne peut donc ni déplacer le cluster ni réinterpréter l’identité.

## Déploiement et retour arrière

Ordre : migration, backfill, API/Web/worker. Une base neuve et une base contenant les anciennes reviews doivent migrer. Le retour arrière désactive la consultation des clusters; les colonnes et tables additives peuvent rester en place. Les décisions personnelles antérieures ne sont jamais supprimées ni réécrites.
