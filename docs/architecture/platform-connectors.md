# Architecture cible — thèmes unifiés et connecteurs OS séparés

État au 8 septembre 2026 : **architecture retenue pour préparer le PoC macOS 2**.
Décision : [ADR-0049](../decisions/ADR-0049-platform-connectors-and-macos-poc2.md).
Le [diagramme Archify](src/platform-connectors.architecture.json) décrit les
frontières produit ; il ne signifie pas que les connecteurs sont déjà qualifiés.

## Décision structurante

Le produit n'est pas un wallpaper multiplateforme construit sur une fenêtre
universelle. Il est composé de deux niveaux :

1. un modèle de thème portable décrit ce que la création veut afficher et faire ;
2. un connecteur natif distinct traduit ces intentions vers les mécanismes réels de
   Windows, macOS ou de chaque famille Linux.

Les thèmes, identités d'objets, comportements, panneaux, actions, sessions et règles
énergétiques restent communs. L'ancrage, le cycle de vie de surface, les permissions,
le routage des entrées et la distribution sont propres à la plateforme.

Cette séparation est obligatoire : les différences entre WorkerW, AppKit et le
provider Wallpaper, Wayland layer-shell, GNOME Shell et X11 ne sont pas des détails
d'implémentation interchangeables.

## Frontières de responsabilité

| Domaine | Propriétaire | Contenu autorisé | Contenu interdit |
| --- | --- | --- | --- |
| Package de thème | Créateur et contrat portable | scène, ressources autorisées, objets, états, actions typées, fallbacks | API OS, chemin privé, asset ROM redistribué |
| Cœur de thème | Commun à tous les OS | validation, identités, graphe sémantique, transitions déterministes, intentions | `NSWindow`, `HWND`, `wl_surface`, TCC |
| Hôte de scène | Backend remplaçable | rendu 2D/3D, animation, hit-test géométrique, invalidation | décision de permission ou priorité des icônes |
| Connecteur OS | Une implémentation par famille | surface native, écrans, espaces, visibilité, énergie, entrée, permissions | règle propre à un jeu ou copie du manifeste |
| Terminal et sessions | Processus indépendant | PTY, grille, état de session, focus demandé | ownership du wallpaper ou ressources du jeu |
| Convertisseur local | Outil froid et optionnel | lecture locale, dérivés privés, recettes de liaison | présence dans le runtime ou redistribution automatique |

Le cœur publie des intentions comme `OpenPanel`, `SelectSession`, `SetEffect` ou
`RequestExternalAction`. Le connecteur répond par un résultat typé : exécuté,
refusé, permission manquante, capacité absente ou état indéterminé. Un thème ne
reçoit jamais directement une primitive native.

## Contrat commun des connecteurs

Le contrat conceptuel minimal comporte cinq groupes de capacités :

- `Surface`: créer, attacher, redimensionner, suspendre et détruire une surface ;
- `Visibility`: annoncer visible, masqué, verrouillé, endormi ou inconnu ;
- `Input`: passif, survol, région interactive ou interaction modale ;
- `SystemAction`: présenter un panneau, focaliser une session ou demander une action
  explicitement autorisée, dont la visibilité des éléments du bureau lorsqu'elle est
  qualifiée ;
- `Lifecycle`: installation, activation, reprise, mise à jour et diagnostic.

Chaque capacité est négociée à l'activation du thème. Une capacité absente ne doit
jamais être simulée silencieusement. Le thème choisit un fallback déclaré, ou le
connecteur refuse uniquement la fonction concernée.

Les contrôles ont des noms portables, pas des implémentations portables. Par exemple,
`desktop.items.visible` décrit l'intention commune de masquer ou montrer les éléments
du bureau. Chaque connecteur publie `supported`, `unsupported` ou `unknown`, applique
seulement après une action utilisateur, relit l'état lorsque possible et renvoie une
quittance corrélée. Le contrôle est désactivé avec une explication si la plateforme
ne possède pas de chemin qualifié.

Un état OS confirmé peut être projeté dans une scène par une action sémantique
bornée. Cette projection ne donne aucune autorité OS au provider : sur macOS,
l'agent relit `desktop.items.visible`, puis transmet seulement visible, masqué ou
inconnu. Le même mécanisme réconcilie les scènes après reconnexion, sans polling.

Le format de ce contrat doit rester indépendant du langage et versionné par schéma.
Le PoC2 peut utiliser des types Swift générés ou écrits localement sans décider que
le cœur portable de production sera en Swift. Rust reste candidat pour le cœur et le
rendu partagés ; aucune FFI Rust/Swift n'est introduite avant que la frontière soit
prouvée par le PoC2.

## Connecteurs prévus

### macOS

Application native de contrôle et adaptateur Wallpaper séparé. Swift/AppKit est le
choix expérimental du PoC2, car la preuve existante dépend d'interfaces Objective-C,
Core Animation, Core Graphics et du cycle de vie Apple. Le provider wallpaper observé
est une interface privée/non garantie : sa faisabilité locale n'est ni une promesse
App Store ni une garantie sur une future version de macOS.

Le connecteur macOS possède TCC, les écrans, Spaces, veille, sélection du provider,
signature et packaging. L'observation globale des clics est une capacité optionnelle.
Le PoC tente le point HID, se replie sur le point de session si macOS refuse HID au
processus non-root, et maintient un watchdog. Un tap annoté plus tardif peut laisser
WindowServer engager son propre geste de révélation du bureau avant le filtrage.
Le transport courant utilise un agent XPC nommé, avec inscription persistante opt-in
et reprise après échec selon [ADR-0055](../decisions/ADR-0055-macos-durable-agent.md),
et un provider sandboxé avec exception de recherche Mach limitée à ce service.
Les signatures sont épinglées mutuellement ; ni PID ni bundle ID seul ne constitue
l'identité de confiance. [ADR-0053](../decisions/ADR-0053-macos-provider-xpc.md) remplace
l'essai App Group, dont la sonde CLI réussissait mais le provider hébergé échouait.
Les premières quittances natives ad hoc sont observées ; aucun succès de gestes,
de cycle Spaces ou de distribution signée n'est déduit de ce transport.
Sans classification certaine de la cible, il ne consomme aucun clic. Le PoC emploie
`CreateDesktop` derrière la capacité portable
`desktop.items.visible`, car `StandardHideDesktopIcons` s'est montré sans effet
visuel sur MAC-01 malgré une écriture et un rechargement confirmés. Cette préférence
reste une implémentation privée du connecteur, jamais une API de thème ni une garantie
multi-version. Visible, Finder est qualifié par AX. Masqué, l'identifiant de fenêtre
porté par chaque événement Core Graphics décide si le geste visait réellement le
desktop. Une fenêtre de niveau normal garde toujours la priorité. Aucune fenêtre
d'entrée, transparente ou visible, n'est créée par cette voie.

L'occlusion plein écran ne dépend pas uniquement d'un callback privé du provider.
Selon [ADR-0057](../decisions/ADR-0057-macos-conservative-occlusion.md), l'agent
qualifie de façon conservatrice les fenêtres opaques actuellement composées sur les
écrans des surfaces actives, puis projette cet état par le XPC existant. La détection
est déclenchée par les événements d'application, de Space, d'écran et de pointeur,
sans polling. Une ambiguïté conserve le thème actif ; seule l'occlusion totale
qualifiée suspend son animation.

### Windows

Connecteur Win32 dédié. Il doit qualifier WorkerW/Explorer sur les versions ciblées,
sans considérer `WS_EX_TRANSPARENT` ou `HTTRANSPARENT` comme une garantie générale
de traversée interprocessus. L'interactivité directe reste conditionnée par une preuve
de priorité des icônes et du bureau natif.
Windows expose le geste utilisateur « Afficher les éléments du Bureau », mais le
connecteur doit encore qualifier un mécanisme programmatique supportable ; il ne doit
pas simuler ce menu contextuel ni écrire une valeur interne sans test de restauration.

### Linux Wayland layer-shell

Connecteur pour les compositeurs qui exposent le protocole requis. Une surface passive
emploie une région d'entrée explicitement vide ; `set_input_region(NULL)` ne signifie
pas vide. Les capacités d'occlusion et de workspace sont annoncées uniquement si le
compositeur fournit les protocoles nécessaires.

### GNOME Wayland

Connecteur séparé, potentiellement constitué d'une extension GNOME Shell et d'un
processus partagé. Sans extension qualifiée, le support reste dégradé : image statique
ou fenêtre de prévisualisation. Il ne partage pas artificiellement l'implémentation du
connecteur layer-shell.

### Linux X11

Connecteur de compatibilité fondé sur les primitives X11/EWMH/XShape effectivement
disponibles. Il est testé et versionné séparément du chemin Wayland.

## Une seule composition et une seule surface de contrôle

Le PoC1 possède actuellement deux représentations de panneau : un panneau décoratif
rendu dans l'extension wallpaper et un panneau AppKit du compagnon qui reçoit les
actions. Cette duplication a servi à prouver séparément le rendu natif et le contrôle,
mais elle crée deux vérités visuelles et deux cycles de vie. Elle est interdite dans
le PoC2.

Un thème déclare un **panneau logique unique**. Le connecteur choisit une présentation :

- panneau de scène, si le chemin d'entrée qualifié peut l'actionner correctement ;
- panneau natif de l'application, pour réglages, permissions et récupération ;
- présentation modale explicite si l'OS ne permet pas une interaction sûre derrière
  les icônes.

Deux présentations simultanées ne sont autorisées que si le thème demande explicitement
un miroir et si elles partagent le même état canonique. Les réglages du connecteur ne
sont pas dessinés comme des objets du décor.

## Ce que le PoC1 apporte, et ce qu'il n'apporte pas

Éléments conservés comme connaissances ou composants à réévaluer :

- inscription et chargement observés d'un provider wallpaper macOS ;
- décor et objets réellement dessinés dans le plan natif du wallpaper ;
- formation déterministe, progression curviligne et hit-test calculé au temps monotone ;
- invalidation événementielle, suspension veille/session et continuité des identités ;
- protocole commande/quittance et reprise TCC déclenchée par événement ;
- tests de package, de scène, de commandes et de runtime.

Éléments qui ne passent pas automatiquement en production :

- les deux manifests `interactive-theme.json` et `formation-theme.json` ;
- les deux panneaux et les contrôles dupliqués ;
- les notifications Darwin comme transport final ;
- les bundles temporaires, signatures ad hoc et réenregistrements manuels ;
- le `CGEventTap` qui consomme un clic sans priorité Finder prouvée ;
- la préférence Finder privée `CreateDesktop` comme action portable ;
- les fenêtres, menus et modes de diagnostic accumulés dans la sonde.

Le code du PoC1 est gelé comme banc historique. Le PoC2 ne le forkera pas en bloc :
chaque élément réutilisé devra avoir un propriétaire, une interface et un test ciblé.

## Invariants de l'architecture cible

1. Un package de thème ne contient aucune API ni logique propre à un OS.
2. Une identité d'objet ou de session reste stable d'un connecteur à l'autre.
3. Un connecteur peut disparaître sans invalider le format des thèmes.
4. Le wallpaper fonctionne sans terminal ; le terminal fonctionne sans wallpaper.
5. Aucun flux PTY brut ne traverse le protocole du wallpaper.
6. Le rendu au repos ne soumet aucune trame sans invalidation, sous réserve des
   contraintes observées du compositeur.
7. Une entrée native prioritaire gagne toujours sur une ancre du thème.
8. Une permission refusée dégrade une capacité, jamais le décor entier.
9. La ROM, les dérivés privés et le convertisseur restent hors du package partageable.
10. La compatibilité est publiée par OS, version, environnement et capacité ; « tous
    les OS » n'est jamais déduit d'une seule abstraction de fenêtre.

## Prochaine preuve

Qualifier la première tranche du [PoC macOS 2](../pocs/macos-connector-poc2.md),
implémentée dans `pocs/macos-connector/` avec un manifeste canonique et un panneau
AppKit unique. [ADR-0052](../decisions/ADR-0052-macos-poc2-implementation.md) borne
son provider privé macOS 26 ; ADR-0053 décrit le transport XPC actuel. Les connecteurs Windows
et Linux ne commencent qu'après stabilisation du contrat commun, sans réutiliser les
primitives macOS.

## Validation documentaire

Le diagramme Archify passe le profil `showcase` avec 9 contrôles sur 9, sans erreur
ni avertissement. Le contrôle visuel automatisé passe à 1440×900, 1600×1000,
1920×1080 et 2048×1320 en clair et sombre. La capture sombre 1440×900 a été inspectée
manuellement, ainsi que la capture sombre 2048×1320 : limites, libellés et relations
sont lisibles, sans collision observée.
L'interface fixe du viewer reste en anglais ; les libellés produit sont en français.

Le diagramme situe les gestes, la modale et le XPC signé dans le connecteur macOS.
`restart-agent.sh` ne redémarre pas le provider ni Finder. Le lancement reste discret,
le diagnostic à la demande ; les gestes sont implémentés mais restent non qualifiés.
L'édition utilise la même frontière de commande, avec configuration validée et
quittance avant sauvegarde locale, selon ADR-0054.
L'annotation macOS `ABI à qualifier` rappelle que la signature du bloc XPC natif
`isChoiceDownloadedWith:reply:` doit être requalifiée après correction vers NSNumber.
Le contrôle de commit exige cette trace pour une signature modifiée ; aucune
nouvelle couche ni frontière produit n'a été ajoutée.
L'hôte de scène porte également l'annotation des icônes Lucide natives : tracés
statiques dans le renderer existant et géométrie partagée avec le hit-test, sans
nouvel overlay. Cette présentation ne qualifie pas la capture de clics macOS.

SHA-256 de la source : `df1ed06c5c752965d4785cf27e597a875d1befa7c6869966d514b6de6e73acd8`.
SHA-256 de l'artefact : `7404eab7bcc78494637f745d40d4d8fc8a74304a62058c29cb5c01e66b9b165c`.
