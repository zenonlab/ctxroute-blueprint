# Sonde native macOS — préparation, pas installation

## Objectif et succès attendu

Remplacer la piste NSWindow superposée par une qualification du point d'extension
Apple `com.apple.wallpaper`. Réutiliser le diagnostic animé ColorDiag de
[Phosphene, révision épinglée](https://github.com/kageroumado/phosphene/tree/8b5bd57c1450eda74cf2ec6ceaae2e586cfdfcd6),
sous licence MIT, plutôt que construire une nouvelle imitation du bureau.
Cette étape réussit si le source fixé compile isolément sans installation,
sans lancer son code, et sans modifier le fond ou les services Apple.

## Reproduire la préparation

Depuis la racine du dépôt, sur macOS avec le SDK et Swift 6 :

```sh
bash pocs/macos-native-wallpaper/prepare.sh
```

Le script clone l'amont si absent, exporte exclusivement la révision fixée dans
un nouveau `dist/pocs/macos-native-wallpaper/compile.XXXXXX`, conserve sa licence,
applique le petit patch ColorDiag et compile avec `swiftc`. Aucun package externe
de l'application hôte n'est construit. Les changements locaux du clone sont ignorés,
jamais écrasés. Les dossiers de build sont conservés, non supprimés automatiquement.
La sortie donne le chemin du binaire et son SHA-256.

Le patch active l'animation par un drapeau de compilation, sans déposer un fichier
dans le conteneur utilisateur. **Ne pas exécuter directement ce binaire** : il ne
constitue ni une application hôte ni un bundle `.appex` installable. La compilation
conserve encore les autres fonctions de l'extension amont, notamment sa récupération
de connexions (`SpiralRecovery`) : elles doivent être auditées et neutralisées si
nécessaire avant tout essai réel. Compiler n'exécute pas ces fonctions.

## Observations locales — 7 septembre 2026

- Machine : MAC-01, Apple M1 Pro, macOS 26.2 ; Swift 6.3.2, SDK macOS 26.5.
- Compilation directe de l'extension amont réussie ; avertissement Swift sur
  l'alternative asynchrone à `updateSettingsViewModels` dans `SettingsPush.swift`.
- Le script versionné avec le patch ColorDiag réussit également : binaire Mach-O
  arm64 dans `dist/pocs/macos-native-wallpaper/compile.brH5zl/NativeWallpaperProbe`,
  SHA-256 `e2a730f8a86bfd11d1349f71a131810647dafb27614fe3ced07224bcf3605d15`.
  Ce hash identifie ce build local, pas une reproductibilité binaire entre machines.
- `xcodebuild -target PhospheneExtension` échoue avant compilation : plugin
  IDESimulatorFoundation incompatible avec DVTDownloads, symbole de documentation
  développeur introuvable. Le fallback `swiftc` évite ce défaut local ; il ne répare
  pas Xcode et ne prouve pas la validité d'un packaging ExtensionKit.
- `security find-identity -v -p codesigning` : zéro identité valide. L'admission
  d'une éventuelle signature ad hoc n'est pas testée, pas déclarée impossible.
- Aucun lancement, sélection dans Réglages, redémarrage de WallpaperAgent,
  écriture de préférences système ou changement de fond effectué par cette préparation.

## Ce que cette voie peut et ne peut pas encore prouver

Le source amont déclare le point ExtensionKit dans `Info.plist`, traite les demandes
de WallpaperAgent en XPC et transmet un contexte distant CAContext. Il conserve
des contextes par écran/identité de surface ; ce mécanisme est plus pertinent à
tester pour les transitions que nos panneaux au premier plan.
Les frameworks/protocoles sont privés : compatibilité et distribution non garanties.
ColorDiag anime une largeur de calque sur 2,5 secondes en aller-retour ; seul un
essai hébergé dira si cette animation traverse effectivement Spaces/verrouillage
sans gel, noir ou recréation. Les commentaires amont signalent eux-mêmes des limites
du transport de couches : aucune continuité n'est acquise par la seule compilation.

Le protocole XPC inspecté n'expose pas de callback de clic sur la scène. Cet essai
n'établit donc ni boutons, ni focus, ni panels interactifs, ni rendu de jeux 2D/3D.
Ne pas remplacer silencieusement ces besoins par un overlay.

## Prochaine preuve, séparée

Préparer un hôte minimal avec identités propres et un bundle `.appex` correctement
configuré ; revoir le code exécuté et la signature. Puis qualifier son admission
par macOS, avec retour au fond antérieur prévu avant sélection explicite.
Tester ensuite animation visible, changements de Spaces, retour au bureau,
verrouillage/déverrouillage et arrêt propre. Mesurer l'énergie seulement après
qualification visuelle. Aucun de ces résultats n'est revendiqué ici.

Décision : [ADR-0047](../decisions/ADR-0047-native-wallpaper-extension-probe.md).
Archify sépare ce chemin de l'ancien PoC :
[source versionnée](../architecture/src/macos-native-wallpaper.architecture.json),
HTML local `dist/architecture/macos-native-wallpaper.architecture.html`.
Libellés français, interface fixe du visualiseur en anglais.

Reçu du schéma : architecture showcase 9/9, zéro erreur/avertissement,
une correction de placement. Source SHA-256
`2817cba332d4b3fc79bdee7b0dd406644cb60df0882b3fc470bf263a6beb7039` ;
HTML SHA-256 `643ee8b89027b776fae9f58aa2f138ac0821816552ddc952abf4dee2fe9414f3`.
Contenance vérifiée à 1440×900, 1600×1000, 1920×1080 et 2048×1320.
Capture sombre 2048×1320 inspectée par l'agent ; reçu automatique de revue humaine
`visualReview: pending`. Ces contrôles concernent le diagramme, pas le fond macOS.

Vérification du dépôt : `npm run verify` réussi (262 tests réussis, un ignoré,
zéro échec ; trois tests MCP réussis ; audit npm sans vulnérabilité).
`bash -n` réussit ; un argument inconnu est refusé avec code 64 avant le build.
Le clone amont reste intact. AGENTS.md, CLAUDE.md et hooks Codex inspectés,
inchangés ; aucune suppression. Ces tests ne lancent pas l'extension native.
