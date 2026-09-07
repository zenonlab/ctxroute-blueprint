# L1 — Sonde de surface macOS

État au 7 septembre 2026 : implémenté, qualification L1 partielle.
Décision : [ADR-0043](../decisions/ADR-0043-isolated-macos-surface-poc.md).
Le [schéma produit](../architecture/src/macos-surface-poc.architecture.json)
montre uniquement cette sonde ; aucun lien au terminal ou à l'ingestion.

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
