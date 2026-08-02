# ADR 0008 — Cache

- Statut : accepté
- Date : 2026-08-02

## Objectif

Réduire les appels aux fournisseurs autorisés et les requêtes vers les sites sans ajouter Redis, sans servir des données d'un autre utilisateur et sans masquer un connecteur cassé.

## Décision

FavLib possède quatre couches distinctes :

### C0 — Extension

- fingerprints keyed des favoris déjà examinés ;
- version du préclassifieur et registre de domaines ;
- file minimale d'événements hors ligne ;
- dernière inspection de la page active.

Les données utilisent `chrome.storage.local`, qui est persistant mais non considéré comme chiffré. Aucun HTML, cookie ou média n'est mis en cache.

Sans permission `unlimitedStorage`, Chrome accorde 10 Mo à `storage.local`. FavLib se limite à 5 Mio au total : 2 Mio pour événements favoris non acquittés, 1 Mio pour résultats privés non acquittés et 2 Mio pour fingerprints/configuration. L'extension mesure l'usage, attend chaque Promise d'écriture et traite tout rejet. Elle purge d'abord les éléments acquittés et fingerprints reconstruisibles ; elle ne supprime jamais silencieusement un événement non acquitté. Un overflow de favoris impose une réconciliation complète ; une observation privée impossible à persister produit un diagnostic de perte potentielle.

### C1 — Métadonnées API

PostgreSQL conserve seulement les réponses normalisées d'un fournisseur `AUTHORIZED`, les résultats de recherche et les échecs temporaires avec `expires_at`, `fetched_at`, version de normalisation, provenance et version de politique. La politique peut imposer des TTL plus courts ou interdire ce cache.

TTL initiaux, configurables :

- recherche fournisseur autorisé : maximum 6 heures, raccourci par sa politique ;
- métadonnées d'une œuvre en cours : 24 heures ;
- œuvre terminée : 7 jours ;
- résultat négatif : 30 minutes ;
- erreur de rate limit : durée `Retry-After` avec jitter.

### C2 — Inspection et disponibilité des sources

Les inspections d'URL et snapshots de sorties sont conservés dans PostgreSQL. La clé complète respecte l'ADR 0004 : connecteur, version, URL canonique, locale, région, mode d'accès et variante.

- `ETag` et `Last-Modified` sont réutilisés ;
- une cible active suit la fréquence de 6 à 12 heures ;
- une œuvre terminée ou inactive a un TTL plus long ;
- un échec n'écrase jamais le dernier snapshot valide ;
- un cache négatif court évite les boucles sur une URL inexistante ;
- les sorties historiques ne sont pas supprimées sur un simple résultat absent.

### C3 — Interface Web

TanStack Query met en cache les vues personnelles avec des clés incluant toujours l'utilisateur/session et l'identifiant de ressource. Les mutations invalident précisément bibliothèque, œuvre, inbox ou préférences concernées.

Les données peuvent être affichées en `stale-while-revalidate`, mais leur âge et l'état du connecteur restent visibles.

## Invalidation

Le cache est invalidé par :

- changement ou suppression du favori ;
- nouvelle version de connecteur, classifieur ou normaliseur ;
- changement de locale, région ou mode d'accès ;
- redirection/canonicalisation validée ;
- correction manuelle d'un matching ;
- action administrateur ciblée et limitée.

Les recomputations utilisent un verrou par clé pour éviter le cache stampede.

## Isolation

- les métadonnées d'un fournisseur sont partageables seulement si sa politique le permet ;
- un snapshot public est partageable uniquement avec un contexte complet identique ;
- progression, préférences, ambiguïtés et vues Web restent par utilisateur ;
- les caches extension/private ne sont jamais mutualisés ;
- aucune réponse personnelle complète n'est indexée par une clé publique seule.

## Conséquences

PostgreSQL reste le seul moteur de données de la V1. Redis pourra être étudié uniquement si des mesures démontrent que les verrous et tables de cache PostgreSQL ne suffisent plus.
