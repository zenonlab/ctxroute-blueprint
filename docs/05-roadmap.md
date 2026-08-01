# Roadmap par waves

## Règle de livraison

Le projet avance par waves courtes et testables. Une wave ne commence pas tant que les critères de sortie de la précédente ne sont pas vérifiés. Chaque sortie contient :

- une version identifiable `wave-X.Y` ;
- les migrations et données de démonstration nécessaires ;
- une commande de démarrage unique ;
- les tests automatisés ;
- une checklist de test manuel ;
- les limites connues ;
- une procédure de retour à la version précédente.

Le plan détaillé de validation se trouve dans [07-waves-et-tests.md](07-waves-et-tests.md).

## Wave 0 — doctrine et jeux de test

Objectif : figer les règles avant le code.

- décisions multi-utilisateur/local/privé ;
- modèle favori, disponibilité et progression ;
- fixtures synthétiques de favoris ;
- maquettes filaires des écrans principaux ;
- connecteur synthétique de référence ; les premiers sites réels sont requis seulement avant la Wave 8 ;
- matrice de confidentialité et permissions ;
- validation de la checklist transversale ;
- doctrine `CLAUDE.md` et ADR acceptés ;
- dépôt Git local initialisé.

Sortie : documentation approuvée et scénarios Given/When/Then exécutables plus tard.

## Wave 1 — socle local et comptes

Objectif : disposer d'une application locale réellement multi-utilisateur.

- monorepo et conventions ;
- Docker Compose, Caddy et origine `https://favlib.home.arpa` ;
- PostgreSQL et migrations ;
- comptes, invitations et rôles ;
- sessions Web et tests d'isolation ;
- endpoints de santé ;
- export de la CA publique et procédure de trust client ;
- sauvegarde minimale chiffrée hors dépôt.

Sortie : deux utilisateurs peuvent se connecter sans voir les données de l'autre.

## Wave 2 — design system et UI contractuelle

Objectif : tester les parcours avant les connecteurs.

- tokens et composants shadcn/ui ;
- shell officiel shadcn/ui `dashboard-01` adapté à FavLib ;
- accueil, bibliothèque, œuvre précise, inbox et tri ;
- états de découverte, candidates à vérifier et raisons de sélection ;
- utilisateurs, appareils et diagnostics admin ;
- responsive desktop/mobile ;
- données fictives réalistes ;
- tests Playwright des parcours.

Sortie : interface navigable avec données de démonstration, sans scraping.

## Wave 3 — appairage et import de tous les favoris

Objectif : prouver le transport robuste depuis plusieurs profils Chrome.

- extension WXT Manifest V3 ;
- onboarding de la permission `bookmarks` ;
- code d'appairage à usage unique ;
- examen local de tous les favoris et import des candidats par lots ;
- réconciliation en deux phases par fingerprints ;
- événements temps réel ;
- file hors ligne et réconciliation ;
- déduplication par installation/utilisateur ;
- révocation d'un appareil.

Sortie : deux profils Chrome importent leurs favoris dans deux comptes séparés, sans doublon après réimport.

## Wave 4 — tri, catalogue local et AniList

Objectif : transformer l'inventaire de favoris en bibliothèque média.

- normalisation URL et titres ;
- tables `media`, alias multilingues, identifiants externes et relations ;
- recherche PostgreSQL exacte + trigramme, avec ambiguïtés explicables ;
- pipeline de classification versionné ;
- service AniList avec cache et backoff ;
- jobs de synchronisation, checkpoints et renormalisation ;
- hydratation à la demande et préchauffage autorisé des œuvres actives ;
- scoring explicable ;
- catégories reconnu/ambigu/ignoré ;
- purge des favoris ignorés ;
- fingerprints keyed locaux invalidables par version du classifieur ;
- calibration sur fixtures.

Sortie : les variantes de nom convergent vers la bonne œuvre, avec rapport de précision et validation des ambiguïtés dans l'interface.

## Wave 5 — connecteur de référence sur fixtures

Objectif : valider le contrat sans dépendre immédiatement d'un site réel.

- connecteur factice/API de test ;
- reconnaissance fiche/chapitre/épisode ;
- canonicalisation ;
- extraction de positions ;
- releases normales, décimales et spéciales ;
- tests de parseur vide ou cassé.
- `discover()` synthétique avec bonnes candidates, ambiguïtés et faux positifs ;

Sortie : pipeline complet déterministe sur fixtures versionnées.

## Wave 6 — worker, disponibilité et inbox

Objectif : détecter une nouvelle sortie de bout en bout.

- file PostgreSQL ;
- scheduler, verrou et limites par domaine ;
- snapshots valides et quarantaine ;
- diff et déduplication ;
- caches PostgreSQL, TTL, invalidation et anti-stampede ;
- mutualisation d'une cible entre utilisateurs ;
- regroupement des origines par sortie logique ;
- import des annonces anime et scheduling proche de la diffusion ;
- séparation vérifiée entre annonce et disponibilité réelle ;
- moteur de découverte borné, états de candidates et budgets ;
- surveillance d'une alternative seulement après épinglage/fallback accepté ;
- résolveur de source préférée et fallback ;
- fan-out vers les inbox personnelles.

Sortie : une seule vérification crée la bonne nouveauté chez plusieurs abonnés, sans fuite croisée.

## Wave 7 — progression par favori et popup précise

Objectif : exploiter le favori comme position utilisateur.

- changement d'URL N → N+1 et navigation contextuelle consentie ;
- consolidation de plusieurs favoris ;
- blocage des régressions incertaines ;
- popup sur fiche, chapitre et épisode ;
- fiche FavLib avec position, disponible et delta ;
- reprise après événement manqué.

Sortie : une observation précise et consentie avance la bonne progression sans modifier les favoris Chrome.

## Wave 8 — premiers sites réels

Objectif : ajouter les sites un par un.

- une sous-wave par domaine ;
- proposition de domaine membre → validation administrateur ;
- implémentation et validation de `discover()` lorsqu'une méthode autorisée existe ;
- recherche de catalogue seulement si API/méthode autorisée ;
- API/RSS prioritaire ;
- fixtures et tests de non-régression ;
- feature flag ;
- tableau de santé ;
- validation manuelle avant le connecteur suivant.

Sortie de chaque sous-wave : un site réel peut reconnaître ses pages, surveiller ses sorties, participer au menu `Sources (N)` et expliquer ses erreurs.

## Wave 9 — notifications et durcissement

Objectif : rendre l'installation locale fiable.

- notifications Web et ntfy ;
- digest et déduplication ;
- option d'alerte différée pour l'origine préférée ;
- audits SSRF/XSS/permissions ;
- rotation des jetons ;
- sauvegarde et restauration complète ;
- journaux structurés et métriques ;
- documentation opérateur local.

Sortie : restauration testée, sécurité validée et fonctionnement continu documenté.

## Après la V1

- Firefox si non inclus dans les premières waves ;
- import AniList/MAL complémentaire ;
- statistiques et listes partageables ;
- mode cloud seulement après conception d'un import explicite et d'un modèle de consentement adapté aux favoris.
