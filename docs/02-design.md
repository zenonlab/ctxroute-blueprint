# Design et références GitHub

## Package GitHub retenu

La fondation officielle est [shadcn/ui](https://github.com/shadcn-ui/ui), sous licence MIT. La Wave 2 partira du block officiel `dashboard-01` pour le shell responsive : sidebar desktop, navigation mobile, header, menus et zones de contenu.

shadcn/ui distribue le code des composants dans le dépôt FavLib. Ce n'est pas un thème distant ou une dépendance visuelle opaque : chaque composant devient modifiable, testable et versionné avec l'application.

On ne reprend pas un template complet de Seanime, Suwayomi, Komga ou Kavita. Ils restent des références de parcours. Les écrans propres à FavLib — œuvre, favori, progression, source et nouveauté — seront composés sur la base shadcn.

### Pile UI figée

| Besoin | Choix | Source et licence |
|---|---|---|
| shell et composants | shadcn/ui `dashboard-01` | [GitHub](https://github.com/shadcn-ui/ui), MIT |
| interactions accessibles | Radix UI Primitives | [GitHub](https://github.com/radix-ui/primitives), MIT |
| styles et tokens | Tailwind CSS | [GitHub](https://github.com/tailwindlabs/tailwindcss), MIT |
| icônes | `lucide-react` | [GitHub](https://github.com/lucide-icons/lucide), ISC |
| thème clair/sombre/système | `next-themes` | [GitHub](https://github.com/pacocoursey/next-themes), MIT |
| état serveur côté client | TanStack Query | [GitHub](https://github.com/TanStack/query), MIT |
| formulaires | React Hook Form + Zod | validation partagée avec les contrats API |
| tests composants | Testing Library + Vitest | tests de comportement, pas de snapshots aveugles |

Les versions seront épinglées au scaffold. Un fichier de notices tierces conservera les licences requises. Aucun second kit UI ne sera ajouté sans décision d'architecture afin d'éviter les styles incohérents.

## Direction recommandée

Une interface « étagère + inbox », sombre par défaut mais lisible en thème clair. L'écran d'accueil doit répondre immédiatement à deux questions : « qu'est-ce qui est nouveau ? » et « où en étais-je ? ».

### Navigation

- Accueil : nouveautés et reprises récentes.
- Bibliothèque : grille/liste, filtres et catégories.
- Calendrier : sorties prévues et détectées.
- Sources : état des connecteurs et dernière vérification.
- Réglages : notifications, fréquence, confidentialité et export.

Un menu de compte permet de changer de profil FavLib, de voir les extensions appairées et de révoquer un appareil. L'administrateur possède en plus les écrans Utilisateurs, Invitations, Santé système et Sauvegardes.

Sur mobile, une barre inférieure remplace la sidebar. L'action principale est « Synchroniser les favoris ». Une file « À vérifier » reçoit les favoris reconnus avec une confiance insuffisante.

### Composants essentiels

- `MediaCard` : affiche, progression, statut et badge de nouveauté.
- `ReleaseRow` : numéro, date, source retenue, menu `Sources (N)` et action « ouvrir ».
- `SourceBadge` : site, santé du connecteur et dernière vérification.
- `ProgressControl` : dernier chapitre/épisode vu et ajustement rapide.
- `UpdateInbox` : nouveautés regroupées par œuvre, jamais par simple chronologie brute.
- `ConnectorDiagnostic` : URL testée, méthode, dernier succès et erreur compréhensible.
- `BookmarkCandidate` : favori détecté, site, correspondance proposée et score de confiance.
- `BookmarkPosition` : position déduite du favori ou d'une navigation consentie, niveau de confiance, statut observé et date.
- `DeviceSession` : profil/installation appairé, dernière synchronisation et révocation.
- `SourceResolver` : préférence, fallback proposé, score et raisons du choix.

### Fiche œuvre

La route `/library/:mediaId` est le centre de décision pour une œuvre précise. Elle présente :

- métadonnées et titres alternatifs AniList ;
- favoris Chrome associés, sans exposer ceux d'un autre utilisateur ;
- sites et pages canoniques détectés ;
- position observée, origine du signal et statut de confirmation ;
- dernière sortie disponible par source ;
- alternatives regroupées pour chaque sortie logique ;
- nombre de sorties après la progression ;
- historique de détection et dernier diagnostic ;
- action pour ouvrir la page exacte sur le site d'origine.

Le menu `Sources (N)` affiche langue, site, édition/groupe, statut officiel vérifié, fraîcheur et santé. Un fallback automatique porte toujours un badge « Alternative » et ne remplace pas silencieusement la source épinglée.

### Extension sur une page précise

La popup affiche l'œuvre reconnue, le type de page (`work`, `chapter`, `episode` ou autre), la position extraite, la dernière sortie connue et un lien vers sa fiche FavLib. Une page suivante peut produire une observation seulement si elle appartient à une œuvre déjà favorite et si le consentement de progression contextuelle est actif. Sinon, elle ne crée aucune entrée parallèle.

## Références retenues

| Projet | Ce qu'on retient | Usage du code |
|---|---|---|
| [Seanime](https://github.com/5rahim/seanime) | hiérarchie visuelle, fiche média, calendrier, sources multiples | inspiration uniquement ; licence GPL-3.0 |
| [Suwayomi WebUI](https://github.com/Suwayomi/Suwayomi-WebUI) | bibliothèque, filtres, badges non lus, migration de source | inspiration et étude des parcours ; vérifier la licence avant toute reprise |
| [Komga](https://github.com/gotson/komga) | responsive, listes de lecture, modes manga/webtoon | patterns réutilisables avec attribution ; licence MIT |
| [Kavita](https://github.com/Kareadita/Kavita) | organisation des collections et continuité de lecture | inspiration ; vérifier les fichiers copiés et leur licence |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | composants accessibles et possédés par le projet | base UI recommandée ; licence MIT |
| [WXT](https://github.com/wxt-dev/wxt) | infrastructure d'extension multi-navigateur | base de l'extension ; licence MIT |

## Système visuel initial

- Couleurs sémantiques, pas de couleur codée directement dans les pages.
- Accent unique personnalisable, avec rouge/orange réservé aux erreurs.
- Affiches en ratio constant et placeholders non animés.
- Densité confortable sur mobile, compacte en option sur desktop.
- Animations courtes seulement pour confirmer une action ou l'arrivée d'une nouveauté.
- États clavier, contraste AA et réduction de mouvement dès la V1.
- Typographie système en priorité pour ne pas dépendre d'un CDN de polices.
- Largeur, rythme d'espacement, rayons, ombres et niveaux de surface définis par tokens.
- Les logos des sites tiers restent séparés de Lucide et ne sont utilisés que si leurs règles de marque le permettent.

## États obligatoires de chaque écran

Chaque écran doit prévoir : chargement, vide, succès, données nombreuses, erreur récupérable, hors ligne, permission refusée et donnée devenue obsolète. Une source cassée ne doit jamais ressembler à « aucune nouveauté ».

## Écrans à maqueter avant le code métier

1. Accueil/inbox, desktop et mobile.
2. Bibliothèque avec filtres.
3. Fiche œuvre avec plusieurs sources.
4. Import de tous les favoris, résultats de tri et ambiguïtés.
5. Popup sur fiche œuvre, chapitre et épisode précis.
6. Gestion des utilisateurs et appareils appairés.
7. Diagnostic d'un connecteur cassé.

## Règle de propriété intellectuelle

On peut étudier les parcours et reprendre des composants sous licence compatible en conservant les mentions requises. On ne copie pas le branding, les illustrations ni le code GPL dans une application que l'on souhaiterait distribuer sous une licence incompatible.
