# Vision et règles produit

## Objectif

FavLib centralise, pour plusieurs utilisateurs, les œuvres enregistrées dans leurs favoris Chrome/Google. L'utilisateur ne recopie pas ses séries dans FavLib : ses favoris constituent l'inventaire d'entrée et le périmètre à surveiller.

L'application répond à trois questions :

1. Quelles œuvres de mes favoris ont été reconnues ?
2. Quel nouveau chapitre ou épisode est disponible, et sur quel site ?
3. Quelle position mon favori indique-t-il pour cette œuvre ?

## Décisions produit actées

- Application multi-utilisateur dès la première version.
- Hébergement local pour le moment.
- Projet privé, sans inscription publique.
- Chaque compte FavLib possède sa bibliothèque, sa progression et ses notifications.
- Tous les favoris URL de chaque profil appairé sont examinés localement, sans imposer de dossier `FavLib` ; seuls les candidats médias quittent l'extension.
- Le catalogue local assure le matching ; AniList est un enrichisseur optionnel, désactivé jusqu'à autorisation documentée et jamais bloquant.
- Un catalogue canonique local conserve les titres natifs, translittérés, traduits, synonymes, identifiants externes et relations entre saisons.
- Une sortie annoncée et une sortie disponible sur un site sont deux états différents.
- L'extension fonctionne à la fois depuis les favoris et sur la page précise ouverte dans le navigateur.
- Les pages d'origine restent l'endroit où lire ou regarder.

## Les trois rôles du favori

### 1. Appartenance

Un favori reconnu signifie que l'utilisateur souhaite voir l'œuvre dans sa bibliothèque FavLib.

Une source alternative découverte pour cette œuvre peut apparaître dans `Sources (N)`, mais elle ne crée ni nouvelle œuvre de bibliothèque, ni abonnement, ni favori Chrome. L'appartenance reste toujours ancrée par au moins un favori personnel actif.

### 2. Source

Le domaine et l'URL indiquent où l'utilisateur lit ou regarde cette œuvre. Le connecteur transforme éventuellement une URL de chapitre en URL canonique de fiche série.

### 3. Progression observée

Si l'URL ou le titre du favori contient un chapitre ou épisode précis, FavLib enregistre cette position comme progression observée. Une modification ultérieure vers une position supérieure peut avancer automatiquement la progression. Après consentement, une page précise ouverte peut également avancer cette observation si son œuvre parente correspond avec forte confiance à une œuvre déjà favorite.

Un favori qui pointe seulement vers la fiche générale permet le suivi des nouveautés mais ne donne aucune progression. FavLib ne doit jamais inventer cette donnée.

## Distinction indispensable

```text
favori = œuvre suivie + site utilisé + position éventuelle
connecteur = sorties actuellement disponibles sur ce site
catalogue = identité, alias, relations et sorties annoncées
delta = sorties disponibles après la position du favori
```

Si le site publie l'épisode 12 alors que le favori pointe toujours vers l'épisode 11, l'inbox annonce l'épisode 12. La progression reste 11 jusqu'à ce que le favori change.

## Parcours utilisateur

1. L'administrateur local crée ou invite un compte.
2. L'utilisateur ouvre FavLib et génère un code d'appairage court.
3. Il installe l'extension dans son profil Chrome et saisit ou scanne ce code.
4. L'extension examine tous les favoris URL et élimine localement les éléments manifestement non médias.
5. Elle envoie les candidats médias par lots idempotents ; l'API les classe en reconnu, ambigu ou ignoré.
6. Les œuvres reconnues apparaissent automatiquement dans la bibliothèque.
7. Les favoris ambigus apparaissent dans « À vérifier » avec les meilleures propositions locales ou d'un fournisseur autorisé.
8. Le worker surveille chaque URL canonique publique sans dupliquer le travail entre utilisateurs.
9. Les nouvelles sorties apparaissent dans l'inbox personnelle.
10. Quand le favori change ou qu'une page suivante de la même œuvre favorite est observée avec consentement, la progression personnelle observée avance.

## Périmètre de la première version complète

### Inclus

- comptes locaux, invitations et rôles administrateur/membre ;
- appairage de plusieurs installations d'extension par utilisateur ;
- examen et réconciliation locale de tous les favoris, avec import des seuls candidats médias ;
- déduplication entre appareils/profils synchronisés ;
- tri automatique et file d'ambiguïtés ;
- adaptateurs de métadonnées optionnels, bloqués par défaut jusqu'à validation de leur politique ;
- catalogue local actualisable et recherche multi-alias ;
- bibliothèque manga/anime par utilisateur ;
- fiche détaillée de chaque œuvre ;
- une ou plusieurs sources par œuvre ;
- découverte contrôlée d'alternatives pour une œuvre déjà favorite ;
- épinglage ou fallback pouvant surveiller une alternative sans modifier les favoris ;
- disponibilité et progression séparées ;
- progression observée depuis un favori précis ou une navigation consentie sur la même œuvre favorite ;
- inbox, calendrier et diagnostics ;
- connecteurs API, RSS, JSON-LD, HTML et extension ;
- notifications internes, Web et ntfy ;
- export et suppression personnels ; sauvegarde/restauration complète par l'administrateur de l'hôte ;
- déploiement local Docker Compose derrière HTTPS.

### Hors périmètre

- inscription publique et hébergement SaaS ;
- ajout manuel d'une œuvre comme parcours principal ;
- téléchargement, hébergement ou republication de médias ;
- extraction de flux vidéo ;
- contournement d'authentification, paywall, CAPTCHA, DRM ou protection anti-bot ;
- envoi des cookies de sites tiers au serveur ;
- suivi silencieux de tout l'historique de navigation ;
- marketplace publique de scrapers ;
- réimport autonome d'un export personnel en V1 ;

## Règles de progression

- Une position extraite est conservée sous sa forme brute et normalisée.
- `12.5`, `12a`, spécial et épisode zéro restent représentables.
- Une progression observée augmente automatiquement seulement si la confiance du parseur et du rattachement à l'œuvre favorite est forte.
- Une régression n'est jamais appliquée silencieusement.
- Plusieurs favoris de la même œuvre forment une seule œuvre ; une position supérieure ne consolide la progression que dans la même séquence ordonnée.
- Supprimer un favori désactive son abonnement associé, sauf si un autre favori actif suit la même œuvre/source.
- L'historique n'est pas supprimé immédiatement avec le favori.

## Critères de réussite

- chaque utilisateur ne voit que ses propres favoris, progression et notifications ;
- un import interrompu peut reprendre sans doublon ;
- un favori reconnu apparaît en moins de 30 secondes après synchronisation ;
- une même page suivie par dix utilisateurs n'est récupérée qu'une fois par cycle ;
- un favori utilisant un titre alternatif rejoint la bonne œuvre canonique ou passe en vérification s'il reste ambigu ;
- une diffusion planifiée n'est jamais présentée comme disponible avant confirmation d'un connecteur ;
- une recherche Web ne crée jamais une source disponible sans validation du connecteur ;
- retirer le dernier favori désactive toutes les surveillances personnelles de l'œuvre ;
- un changement de favori N → N+1 avance la bonne œuvre, jamais une homonyme ;
- une page non rattachée à une œuvre favorite ne produit aucune progression ;
- aucune nouveauté n'est annoncée sur un parseur devenu vide ou incohérent ;
- chaque wave est démontrable, testable et réversible indépendamment.
