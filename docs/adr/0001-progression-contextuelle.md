# ADR 0001 — Progression contextuelle

- Statut : accepté
- Date : 2026-08-02

## Contexte

Un favori Chrome ne change pas automatiquement lorsque l'utilisateur navigue ou lorsqu'un site publie. Une progression fondée uniquement sur `bookmarks.onChanged` resterait donc figée, sauf édition manuelle du favori. FavLib doit rester en lecture seule sur l'arbre Chrome et ne doit pas suivre tout l'historique de navigation.

## Décision

Le favori reste l'ancre obligatoire : il rattache une œuvre, une source et une cible canonique à l'utilisateur.

Deux signaux peuvent créer une `progress_observation` :

1. une page chapitre/épisode présente directement dans les favoris ;
2. après consentement pendant l'appairage, une page précise ouverte dont l'œuvre parente correspond avec forte confiance à une œuvre déjà favorite.

Le content script du connecteur émet seulement l'identité de l'œuvre favorite, la sortie reconnue, le niveau de confiance et l'heure. Il ne transmet ni historique général, ni DOM complet, ni durée de visionnage.

L'ouverture produit une progression `observed`, pas une preuve sémantique que l'épisode a été vu jusqu'au bout. Une confirmation `completed` pourra être ajoutée ultérieurement avec une action explicite ou une intégration légitime du lecteur.

L'extension ne modifie jamais le favori. `bookmarks.onChanged` reste un signal supplémentaire si l'utilisateur change volontairement son URL.

## Garde-fous

- domaine et connecteur approuvés ;
- œuvre parente identique au favori logique ;
- position à forte confiance ;
- événement idempotent par installation/navigation/sortie ;
- aucune régression silencieuse ;
- consentement révocable par appareil ;
- mode désactivable dans les préférences utilisateur.

## Conséquences

FavLib peut avancer automatiquement sans écrire dans Chrome. La progression doit être libellée « observée » tant qu'aucun signal de fin fiable n'existe.
