# L1 — Sonde de surface macOS

État au 8 septembre 2026 : implémenté, qualification L1 partielle.
Décision : [ADR-0043](../decisions/ADR-0043-isolated-macos-surface-poc.md).
Le [schéma produit](../architecture/src/macos-surface-poc.architecture.json)
montre uniquement cette sonde ; aucun lien au terminal ou à l'ingestion.

## Essai actuel — wallpaper natif et plan d'objets (ADR-0048)

[ADR-0048](../decisions/ADR-0048-native-wallpaper-dynamic-object-plane.md) retient
la seconde architecture, corrigée après inspection visuelle : le wallpaper natif
dessine le fond **et tous les objets** ; un compagnon transparent projette seulement
leurs zones de hit-test et le panneau demandé.
Le mode `--overlay-only` ne crée aucune surface de fond visible. Quatre véhicules
originaux sont décrits dans une ressource JSON, puis un solveur pur calcule leurs
positions et orientations sur une ellipse à partir d'une phase unique. Leur ordre
reste déterministe et les deux plans ne possèdent jamais deux horloges concurrentes.
La projection reproduit la progression curviligne `paced` du chemin Core Animation ;
une progression angulaire naïve dérivait auparavant hors des véhicules visibles.

Le mode overlay n'utilise plus de `NSPanel` mobile par objet. Un `CGEventTap` actif
calcule la position courante au clic puis applique un hit-test de `112×70` autour du
véhicule. L'appui et le relâchement d'un impact confirmé sont consommés ensemble.
Le rectangle du panneau natif est exclu du hit-test global : ses boutons restent
prioritaires même lorsqu'un véhicule passe derrière eux. Le tap est désactivé si
l'écran dort ou si la session devient inactive. Il exige l'autorisation Accessibilité.
Le wallpaper Apple qualifié séparément par ADR-0047 n'est ni arrêté ni rechargé.

Le panneau ne suit plus le véhicule. Il est ancré en haut à droite du bureau et n'est
repositionné que si la géométrie d'écran change. Les identifiants de diagnostic ne
sont plus affichés. Il contient un bouton explicite **Masquer/Afficher les fichiers**.
Cette action modifie la préférence Finder non documentée `CreateDesktop`, puis demande
à Finder de se relancer. Elle ne déplace et ne supprime aucun fichier. Ce raccord reste
isolé, réversible, non exécuté par les smokes et à requalifier sur chaque macOS.
[Les réglages Finder publics documentés par Apple](https://support.apple.com/guide/mac-help/change-finder-settings-on-mac-mchlp2803/mac)
n'exposent que l'affichage des appareils connectés sur le bureau, pas un interrupteur
public pour tous les fichiers.

```sh
sh pocs/macos-surface/probe.sh test
sh pocs/macos-surface/probe.sh desktop --split-input --overlay-only --duration 180
sh pocs/macos-surface/probe.sh desktop --split-input --overlay-only --smoke --duration 6
```

Preuves automatisées du 8 septembre 2026 : 16 tests XCTest réussis. Ils couvrent
le décodage/validation du thème, le déterminisme, l'ordre stable et une séparation
minimale des quatre objets sur 41 positions de la courbe. Le smoke overlay réussit
16 assertions : quatre surfaces, sélection d'identité, ouverture/fermeture du
panneau, politique de premier clic, masquage complet du plan dynamique et handlers
de pause/veille. Il vérifie le contrôle Finder sans l'actionner. Son reçu rapporte
`input_policy: active-filtered-event-tap`,
`overlay_only: true` et `window_ordered_visible: false` pour la fenêtre de fond.
Les clics sont programmatiques et Finder n'était pas au premier plan ; ce résultat
ne prétend donc pas prouver le clic matériel, l'animation visible ou la priorité
d'une icône native superposée.

La fixture et les formes de véhicules sont originales. Elles démontrent le contrat
générique attendu pour un thème de course ; elles ne contiennent aucun asset ou
algorithme propriétaire de Mario Kart. Un futur adaptateur local pourra mapper les
objets autorisés d'un jeu sur ces identités sans intégrer le contenu de la ROM au
package partageable.

## Essai historique — deux plans (ADR-0046)

Le retour utilisateur invalide l'expérience de la version ADR-0045 : apparence
superposée, disparition aux transitions et absence de clics sur le décor.
Les tests internes antérieurs ne contredisent pas cette observation.

[ADR-0046](../decisions/ADR-0046-split-input-experiment.md) introduit une variante
optionnelle, inspirée des responsabilités observées dans Übersicht, sans copie
de son code : fond passif et petites fenêtres NSPanel non activantes à normal − 1.
Objet fixe à gauche → panneau → Halo/Pause/Fermer, sur le même état de sonde.
Un marqueur séparé montre la phase d'animation sans déplacer la cible de clic.
Les fenêtres de contrôle sont **au-dessus des icônes Finder** : priorité des icônes
superposées NON supportée, mode non conforme au produit, jamais activé par défaut.
Hors de leurs rectangles, ces fenêtres ne couvrent pas le bureau.

```sh
sh pocs/macos-surface/probe.sh desktop --split-input --export-still --duration 180
sh pocs/macos-surface/probe.sh desktop --split-input --export-still --smoke --duration 6
```

L'export capture seulement notre vue dans `desktop.*/continuity-UUID.png`, à côté
de la .app. Il n'applique aucun réglage macOS. Il exclut les panneaux interactifs,
les fenêtres tierces et les icônes Finder. Il prépare une image de transition,
sans résoudre les transitions tant que l'image n'est pas appliquée et éprouvée.
Une future application doit obtenir l'accord utilisateur et prévoir une restauration
qui ne prétende pas restaurer une configuration dynamique à partir d'une simple URL.

Preuves locales : compilation release et 11 tests XCTest passent. Le smoke split
réussit ses 12 assertions ; 6 actions programmatiques, `split_mouse_downs: 0`,
`simulation_ticks: 0`, `system_wallpaper_modified: false`. PNG exporté 3024×1964.
Le compteur de vrais `mouseDown` n'est pas incrémenté par `performClick`.
Computer Use capture la surface de fond, mais le clic ciblé échoue avec
`noWindowsAvailable`. Une seconde lecture retrouve uniquement la surface de fond.
Ce contrôle à distance ne valide ni premier clic réel, ni continuité Spaces/Mission Control.
Le test prolongé est borné à 180 s et ne doit pas être confondu avec un service.

Reçu du test prolongé `desktop.Gq0jnR`, arrivé après l'échec du contrôle distant :
40 `mouseDown` et 40 actions locales, 403 ticks, 4 notifications de Space, code 0
après 180 s. `application_active: false` à la fin, panneau ouvert. Il prouve des
entrées reçues pendant cette exécution sans smoke, pas leur provenance précise,
la latence du premier clic, l'absence de vol de focus sur toute la durée ou la
continuité visuelle. Aucun test d'icône superposée n'est déclaré réussi.
Cette exécution précède seulement l'ajout du marqueur animé distinct et du libellé
d'avertissement ; le smoke de la version finale reste la preuve structurelle.

Sources examinées :

- [Übersicht, séparation des fenêtres](https://github.com/felixhageloh/uebersicht/blob/master/Uebersicht/UBWindowGroup.m),
  [niveaux et focus](https://github.com/felixhageloh/uebersicht/blob/master/Uebersicht/UBWindow.m),
  [entrée/sortie de widget](https://github.com/felixhageloh/uebersicht/blob/master/Uebersicht/UBWebViewController.m).
- [Wallnetic, synchronisation du fond système](https://github.com/fatihkan/wallnetic/blob/main/src/Wallnetic/Services/SystemWallpaperSync.swift) :
  mécanisme de repli fixe, pas preuve que nos blancs ont cette seule cause.
- [Apple, acceptsFirstMouse](https://developer.apple.com/documentation/appkit/nsview/acceptsfirstmouse(for:)) :
  accepter le clic initial ne suffit pas si le système ne route pas ce clic vers la fenêtre.

Archify : architecture showcase 9/9, zéro erreur/avertissement.
Source SHA-256 `0f3d06717d523f553a7f80d0b87af918dcc37e87a40e65be3add223873eaa3c5`.
HTML SHA-256 `a072e37a3faa21e15c1d044c71e70cf75e4cac04fbc1560901974e7175ff2965`.
Libellés français, interface fixe anglaise. Les sections suivantes sont historiques.
Visual-check réussi sur quatre tailles ; capture sombre 2048×1320 inspectée,
revue humaine du reçu `pending`. `npm run verify` passe (262 tests, 1 ignoré,
3 intégrations, zéro échec). Le Sensor Swift reste lexical (`WARN`), compensé
par compilation native/XCTest, pas par une prétendue analyse syntaxique complète.
AGENTS.md, CLAUDE.md et hooks inspectés, inchangés.

## Version actuelle — animation et transitions (ADR-0045)

[ADR-0045](../decisions/ADR-0045-desktop-motion-and-transitions.md) sépare animation
et droit de clic : le fond demande l'animation, ignore toujours la souris, et propose
Pause/Reprendre, Animation, Halo et Arrêter depuis le menu macOS **WP**. Ce menu
n'est pas l'interactivité géométrique demandée pour le produit final. Aucun hook
global ni panneau superposé aux icônes n'est ajouté.

La même fenêtre et le même état sont conservés ; couche backing, `canHide = false`,
`hidesOnDeactivate = false`. Les handlers Spaces et réveil réordonnent cette fenêtre
sans reconstruction. Ils ne promettent pas une absence de blanc pendant l'animation
de Mission Control ou lors du passage plein écran, non reproduits ici.

Le pacing distingue `appkit_visible` brut de `scheduling_source`. Si AppKit n'annonce
pas la visibilité, le repli explicite `finder-frontmost-proxy` autorise l'animation
sur un Space actif avec surface ordonnée et Finder au premier plan. Ce n'est pas
une mesure d'occlusion : une fenêtre Finder peut couvrir le fond. Session inactive,
veille écran, pause et réduction des animations bloquent la simulation. Aucun watt
n'est mesuré. L'événement d'activation n'enregistre que le booléen Finder, pas une
liste d'applications ni leurs contenus.

Preuves : 11 tests XCTest réussis, dont les 64 combinaisons des gardes de pacing,
animation sans droit de clic et conservation d'état pendant suspension.
`desktop --smoke --duration 6` : 9 contrôles de handlers/menu réussis, code 0,
4 actions locales, 2 réordonnancements de la même surface. `simulation_ticks: 0`
et `motion_observed_in_ticks: false` dans cette session inactive : ne pas présenter
ce smoke comme preuve d'une animation affichée. Les événements Spaces/veille sont
synthétiques dans ce test, explicitement étiquetés `synthetic-handlers-only`.

Prochaine preuve : lancer `desktop --duration 300`, revenir sur Finder et utiliser
WP → Halo/Pause/Reprendre. Éprouver séparément Spaces, sortie du plein écran et
Mission Control ; préciser lequel fait disparaître le fond. Ne pas confondre ce
défaut avec l'arrêt automatique après 300 secondes.

Archify actualisé : architecture showcase 9/9, zéro erreur/avertissement.
Source SHA-256 : `9d092f5648ec1372a549fc673a1acec12fb4eea79ff2b053be729c38e6228b7d`.
HTML SHA-256 : `75c90473252b7706da0db9ad43a2465e1775cbc0e7322c19a230d838256cca04`.
Visual-check réussi sur quatre tailles ; capture sombre 2048×1320 inspectée.
Interface fixe anglaise et labels français ; revue humaine du reçu toujours `pending`.
`npm run verify` réussit : 262 tests, 1 ignoré, 3 intégrations, aucun échec.
Le Sensor reste en couverture lexicale Swift (`WARN`, parseur indisponible) ;
la compilation native et XCTest constituent les vérifications Swift effectives.
AGENTS.md, CLAUDE.md et hooks inchangés.
Les sections suivantes conservent les preuves des versions antérieures.

## Correction du lancement bureau — ADR-0044

`sh pocs/macos-surface/probe.sh desktop --duration 60` lance désormais une `.app`
via LaunchServices en arrière-plan. `run` reste la fenêtre de diagnostic et ne
doit plus être présenté comme la démonstration du wallpaper. Le bundle local est
construit sans installation, dans `dist/pocs/macos-surface/desktop.*/` ; ses reçus
restent dans ce même dossier. Le lanceur attend la fin et vérifie le code du reçu.
Sans reçu valide, il échoue. Voir [ADR-0044](../decisions/ADR-0044-desktop-launch-services.md).

L'ordre change de `orderBack` à `orderFrontRegardless`, toujours dans le niveau
desktop + 1, sous desktopIcon. Selon la [documentation Apple](https://developer.apple.com/documentation/appkit/nswindow/orderfrontregardless()),
cette méthode n'active pas la fenêtre clé et ne la déplace pas hors de son niveau.
La correction de lancement ne prouve pas que l'ancien ordre était la seule cause
de l'invisibilité ; `notVisible` reste observé au reçu de fin.

Preuves du 7 septembre 2026, MAC-01 :

- Compilation release et 8 tests Swift réussis ; `plutil -lint` et `sh -n` réussis.
- Lancement `.app` de 60 s terminé, reçu code 0 : bundle identifié,
  1512 × 982 points, `window_ordered_visible: true`, `below_desktop_icons: true`,
  `application_active: false`, `is_key_window: false`, `ignores_mouse_events: true`.
- Un callback de dessin, aucun tick et aucun timer d'animation : contenu statique.
- Computer Use reconnaît cette fois `com.wallpaper.poc.desktop` et obtient une
  capture de sa surface sans bordure, inspectée. Cela prouve le rendu de la surface,
  pas une capture composée avec les icônes Finder ni un verdict énergétique.
- Une fenêtre Finder a été minimisée pour l'observation ; le contrôle GUI du
  Finder/Dock a ensuite échoué (`cgWindowNotFound`, timeout). Sa restauration
  n'a pas été confirmée. Aucun fichier du Finder n'a été déplacé ou supprimé.
- Superposition des icônes, clics, Spaces, écrans multiples et arrêt forcé du
  lanceur restent non qualifiés. Le runtime lui-même ne capture pas le bureau.

Le fond conserve volontairement le dessin de test. Aucun jeu, animation de course,
terminal, interactivité bureau ou rendu 3D n'est ajouté par cette correction.

Schéma actualisé avec Archify : `architecture`, showcase 9/9, zéro erreur et
avertissement. Source SHA-256 : `eab35cdf902bdb4e35e5d2f091de8c14ba3353e3115232fd218b5bf132760163`.
HTML SHA-256 : `0c28f7a83c722384696013bb1e80480b1727fbef20408b05deb10d94feb8540b`.
Interface fixe en anglais, labels français ; HTML sous `dist/architecture/`.
Le visual-check actualisé passe sur quatre tailles ; capture sombre 2048×1320
inspectée, revue humaine toujours `pending` dans le reçu automatique.
Un second lancement de 2 s reproduit le reçu nominal et termine avec code 0.
Le cas invalide `desktop --duration 0` termine avec code 1, sans reçu de succès ;
l'erreur d'arguments du binaire est conservée dans `stderr.log`.
`npm run verify` repasse : 262 tests réussis, 1 ignoré, 3 intégrations réussies,
aucun échec et aucune vulnérabilité npm. AGENTS.md, CLAUDE.md et hooks inchangés.

## Isolation

Un package SwiftPM autonome sous `pocs/macos-surface/`, zéro dépendance tierce.
Pas d'import du blueprint, du futur Rust, de PTY ou d'assets de jeu. Sorties sous
`dist/pocs/macos-surface/`, aucun lancement automatique à la connexion. Le binaire
ne modifie pas le fond système, les fichiers de bureau ou les réglages de focus.
Cette séparation n'est pas une sandbox contre du code hostile.

## Critères de sortie L1

Compilation Swift avec avertissements bloquants et tests de configuration/état.
Fenêtre : objet accessible → panneau → action → animation locale → état actualisé.
Pause/reprise sans progression cachée ; fermeture et durée limite libèrent la sonde.
Bureau : mode exclusivement passif, aucune prise de focus ou action d'ancre.
Un reçu rapporte seulement les observations exécutées, pas la compatibilité générale.

Les tests de clics réels, superposition Finder, Spaces et multi-écrans sont manuels
et restent non exécutés tant qu'un relevé ne les atteste. Une capture optionnelle
porte sur notre vue seule, jamais sur l'écran ou les fenêtres tierces.

## Validation et limites

SwiftPM/XCTest est le gate du PoC ; `npm run verify` reste le gate de l'outillage.
Sensor Swift est lexical, sans garantie syntaxique ; le compilateur fournit cette
vérification. Aucun résultat en watts, benchmark wgpu ou qualification Windows/Linux
ne découle de L1. L2 (course) et L3 (scène 3D) restent séparés.

## UI et accessibilité

Réutiliser NSButton pour les actions, NSBox/NSStackView pour le panneau non modal,
NSTextField pour les labels. Le dessin procédural est une surface de diagnostic
originale, pas un nouveau toolkit UI. Tokens nommés de couleur, espace et mouvement
mappés aux couleurs sémantiques AppKit et à une palette de test centralisée.
Action d'objet également accessible par bouton natif, raccourcis de pause et de
fermeture ; aucune saisie clavier en mode bureau passif. VoiceOver reste à éprouver.

## Commandes et preuves exécutées

Guide de lancement : [README du package](../../pocs/macos-surface/README.md).

```sh
sh pocs/macos-surface/probe.sh test
sh pocs/macos-surface/probe.sh desktop --duration 60
```

Machine : MAC-01, macOS 26.2 build 25C56, arm64, Apple M1 Pro, 16 Go.
Compilateur observé : Swift 6.3.2 ; SDK Xcode macOS 26.5 ; cible compilée macOS 14.
Cette cible minimale ne constitue pas un essai sur macOS 14.
Le `SDKROOT` hérité pointait vers un SDK absent : le lanceur sélectionne le SDK
local avec `env -u SDKROOT xcrun --sdk macosx --show-sdk-path`, sans changer Xcode
ou les variables globales. Aucun paquet tiers n'a été installé.

| Essai exécuté | Résultat observé | Portée |
| --- | --- | --- |
| SwiftPM release, avertissements bloquants, XCTest | 8 tests réussis, aucun échec | Options bornées, état, pause/reprise, réduction des animations, refus d'actions en bureau |
| `sh -n pocs/macos-surface/probe.sh` | Code 0 | Syntaxe du lanceur uniquement |
| `run --smoke --duration 6` | Code 1 ; 8 contrôles sur 9 réussis ; 8 actions, 0 tick, 9 callbacks de dessin | AppKit rapporte `notVisible`, fenêtre non clé : progression animée non validée |
| `run --mode desktop --duration 2` | Code 0 après environ 2 s ; souris ignorée, fenêtre non clé, 0 action, 0 tick | Surface créée puis retirée ; visibilité réelle et gestes Finder non éprouvés |
| `run --duration 2` | Code 0 ; 1 callback de dessin, 0 tick, aucun timer d'animation avant nettoyage | Repos observé dans une fenêtre signalée invisible ; pas une mesure de repos visible |
| Capture de notre vue seule | PNG produit et inspecté | Géométrie et labels présents ; contrôles natifs incomplets dans la capture, pas de validation visuelle globale |
| Sensor explicite sur les 8 fichiers Swift | Code 1 / WARN : 8 avertissements `parser-unavailable` | Couverture lexicale seulement ; aucune qualification syntaxique ou sécurité Swift par Sensor |

Le smoke déclenche `NSButton.performClick`, pas des clics matériels. L'échec de
progression est conservé ; ni le signal de visibilité ni le résultat ne sont forcés
pour faire passer le test. Sa cause en amont (session graphique, présentation ou
intégration AppKit) reste à déterminer sur une session visible. Une pause sans
tick préalable ne prouve pas la pause d'une animation réellement affichée.

La capture utilise `cacheDisplay` de notre NSView, sans capture du bureau.
Les fichiers temporaires de build/capture sont ignorés par Git. Le reçu JSON est
émis sur stdout sans sauvegarde automatique ; aucun contenu utilisateur n'y figure.
Les compteurs `draw_callbacks` ne sont ni des présentations GPU ni des watts.
Le délai maximum dépend du retour de la boucle principale ; un gel de processus
nécessiterait un arrêt externe et n'est pas couvert par cette minuterie.

## Reprise et limites de validation

Prochaine action : vérifier le bureau via `desktop`, sans le confondre avec `run`
qui lance une fenêtre de diagnostic. Consigner clic/double-clic/
glisser/sélection Finder, Spaces et changement d'écran sans capturer de données
privées. Ne pas activer d'interaction desktop avant ces preuves.

L'isolation des tests d'initialisation du blueprint a été corrigée : fixture
temporaire plutôt que relance de l'initialiseur contre le dépôt réel. Le dépôt
est passé à `initialized` via l'initialiseur, puis a été revalidé. AGENTS.md,
CLAUDE.md et hooks restent inchangés. Les tests Swift restent un gate macOS local
distinct de `npm run verify` ; le CI JavaScript/JSON ne couvre pas Swift.

Gate dépôt exécuté après implémentation : `npm run verify` code 0, 262 tests
réussis, 1 ignoré, aucun échec ; 3 tests d'intégration réussis ; audit npm sans
vulnérabilité. `npm run blueprint:review` réussi. Ce résultat ne transforme pas
le smoke graphique en succès et ne remplace pas les 8 tests Swift indépendants.

## Diagramme livré

Le reçu ci-dessous correspond à la version initiale du schéma, avant ADR-0044.

Archify `architecture`, showcase 9/9, zéro erreur et avertissement ; quatre tailles
1440×900 à 2048×1320 sans débordement. Capture sombre 2048×1320 inspectée ; le reçu
automatique conserve `visualReview: pending` pour la revue humaine.
Libellés français, interface fixe du visualiseur en anglais.
HTML : `dist/architecture/macos-surface-poc.architecture.html`.
SHA-256 source : `8a319e61e73232812684863b1ba6576f16e8dfd6ade1621e2460bb0dbf332b25`.
SHA-256 HTML : `2386e62f2f3e7142bc063d7736ba0da2ceaa19f2a8e88c4cca63137c590d788a`.
