# ADR 0011 — Découverte et surveillance des sources

- Statut : accepté
- Date : 2026-08-02

## Objectif

À partir d'une œuvre ancrée par un favori, trouver d'autres sites susceptibles de proposer cette œuvre, prouver chaque correspondance, puis décider lesquels surveiller sans transformer FavLib en moteur de recherche ou agrégateur de contenus.

## Déclencheurs

La découverte est bornée et n'est jamais lancée à chaque cycle de surveillance. Elle peut être déclenchée par :

1. le premier rattachement fiable d'un favori à une œuvre ;
2. l'action utilisateur « Trouver d'autres sources » ;
3. une source préférée devenue indisponible après plusieurs erreurs ;
4. une migration de domaine à confirmer ;
5. l'activation ou la nouvelle version d'un connecteur compatible.

Chaque lancement possède motif, initiateur, budget, locale/région, checkpoint et date de prochaine autorisation.

Deux runs identiques sont verrouillés par `(media_id, connector_set_version, approved_domain_set_hash, locale, region)`. Le cooldown utilisateur initial est de 24 heures ; un fallback automatique n'ouvre pas plus d'un run par œuvre sur 7 jours. L'administrateur peut relancer de façon ciblée et journalisée.

## Ordre de découverte

Pour une œuvre déjà favorite, `SourceDiscovery` interroge dans cet ordre :

1. autres favoris personnels déjà rattachés à l'œuvre ;
2. liens officiels, externes ou de streaming du fournisseur catalogue ;
3. méthode `discover()` des connecteurs actifs ;
4. domaines proposés par un membre puis approuvés par l'administrateur local ;
5. fournisseur de recherche Web optionnel, limité aux domaines approuvés.

Un résultat de moteur de recherche est seulement un indice. Son titre, URL ou snippet ne suffit jamais à créer une origine.

## Contrats

```ts
interface SourceConnector {
  discover?(input: DiscoverInput): Promise<DiscoveryResult[]>;
  inspect(input: InspectInput): Promise<SourceInspection>;
  check(input: CheckInput): Promise<CheckResult>;
}

interface SearchProvider {
  searchApprovedDomains(input: {
    queries: string[];
    domains: string[];
    locale: string;
    region: string;
    budget: number;
  }): Promise<SearchHint[]>;
}
```

`DiscoverInput` contient identifiants externes, type, format, année/saison et un sous-ensemble borné des alias pertinents. Une requête par domaine privilégie identifiant externe puis titre exact et année. Les clés d'API de recherche restent côté serveur et le fournisseur est interchangeable.

Un domaine sans connecteur peut être découvert, mais reste `PENDING_CONNECTOR` : aucune surveillance automatique n'est possible avant la sous-wave exigée pour ce domaine.

## Cycle de vie d'une candidate

```text
DISCOVERED
  ├─ PENDING_CONNECTOR
  ├─ REJECTED
  └─ INSPECTED
       ├─ NEEDS_REVIEW
       └─ VERIFIED
            ├─ AVAILABLE
            ├─ STALE
            ├─ BROKEN
            └─ MIGRATED
```

`inspect()` canonicalise l'URL et rassemble des preuves. Le cœur métier compare ensuite œuvre, alias, type, année/saison, identifiants externes et relation de franchise. Un match fort produit `VERIFIED`; un homonyme ou conflit produit `NEEDS_REVIEW`.

Chaque transition conserve connecteur/version, preuves, score, raisons, auteur automatique ou humain et horodatage. Une validation ou fusion manuelle est réversible.

La clé de candidate inclut œuvre, URL canonique, locale, région, mode d'accès, variante de représentation et scope propriétaire éventuel. Plusieurs méthodes découvrant la même clé fusionnent leurs preuves dans une seule candidate. Une cible publique et une cible privée ne sont jamais fusionnées.

## Surveillance personnelle

- la source issue du favori crée automatiquement un `user_subscription` ;
- une candidate seule ne crée rien de personnel ;
- ouvrir ponctuellement une alternative ne crée pas d'abonnement ;
- épingler une alternative ou l'accepter comme fallback peut créer un `user_subscription`, uniquement tant que l'œuvre possède au moins un favori personnel actif ;
- retirer le dernier favori désactive `library_item`, préférences et abonnements personnels associés, tout en conservant l'historique public ;
- une cible publique surveillée par plusieurs personnes reste vérifiée une seule fois par contexte ADR 0004 ;
- une cible privée/authentifiée reste liée à l'installation qui peut l'inspecter localement.

## Variantes compatibles

Une origine décrit séparément :

- langue du contenu ou de la traduction ;
- langue audio et langue des sous-titres lorsqu'elles existent ;
- édition, groupe, censure et qualité déclarée ;
- région et mode d'accès ;
- officiel/licencié seulement lorsque ce statut est vérifié.

Le résolveur n'utilise comme fallback automatique qu'une origine compatible avec les filtres explicites de l'utilisateur. VF, VOSTFR, version originale et traduction de groupe ne sont jamais supposées équivalentes silencieusement.

## Notifications

Par défaut, un utilisateur reçoit une seule notification quand la première origine compatible d'une sortie logique devient disponible. Une origine supplémentaire met à jour `Sources (N)` sans nouvelle notification.

Une notification distincte `PREFERRED_ORIGIN_AVAILABLE` peut être activée par l'utilisateur si sa langue ou source préférée arrive après une autre origine ; elle est désactivée par défaut.

La clé de déduplication inclut `(user_id, release_id, event_kind, preference_signature)`. Une republication de la même origine ou une reprise de job ne crée pas une nouvelle sortie. Une correction réelle conserve l'historique et exige un événement explicitement typé.

## Recherche Web et domaines proposés

- un membre peut proposer un domaine, jamais une URL réseau interne arbitraire ;
- l'administrateur vérifie méthode autorisée, conditions, robots, DNS et capacités avant activation ;
- Google/Brave/autre reste un plugin de découverte, jamais la source de vérité ;
- requêtes, résultats et coûts sont limités par utilisateur, instance et domaine ;
- les recherches planifiées n'incluent aucune information personnelle issue du chemin de favoris ;
- FavLib conserve les preuves normalisées utiles, pas les snippets complets du moteur ; une candidate rejetée perd rapidement son URL lisible et garde seulement hash, motif et métrique agrégée ;
- les résultats passent les contrôles SSRF, redirections et IP avant inspection ;
- CAPTCHA, paywall, DRM et anti-bot arrêtent le parcours avec un diagnostic visible.

## Nouvelles saisons et conflits catalogue

Une suite découverte est signalée sur l'œuvre favorite, mais n'entre pas dans la bibliothèque sans favori. Un conflit entre fournisseurs ne fusionne jamais deux `media` sur le titre seul : identifiants, relations et preuves sont nécessaires, avec décision auditée et rollback.

## Conséquences

FavLib sait chercher des alternatives sans les considérer fiables par défaut. La découverte, la validation, la surveillance et la notification deviennent quatre étapes indépendantes et observables.
