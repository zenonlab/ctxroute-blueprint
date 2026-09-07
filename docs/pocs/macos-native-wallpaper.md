# Sonde native macOS — paquet local de test

## Tester le paquet préparé

Le build courant est dans
`dist/pocs/macos-native-wallpaper/compile.YbX8ea/Native Wallpaper Probe.app`.
Ouvrir cette application dans Finder, puis cliquer « Ouvrir les réglages ».
Elle n'affiche pas de fenêtre wallpaper : sa boîte de dialogue explique le test.
Dans Réglages > Fond d'écran, rechercher **Native Wallpaper Probe**, puis
**Balayage diagnostic**. Noter le fond actuel avant toute sélection.

Le résultat attendu est une surface verte avec une largeur magenta animée,
hébergée par le système. Tester le retour au bureau et deux changements de Spaces.
Les boutons dans le décor et le terminal ne font pas partie de cet essai.
Si l'entrée est absente, ou si la surface reste noire/statique, l'essai a échoué :
ne pas présenter la signature ou l'enregistrement comme une réussite visuelle.
Ne pas désactiver les protections macOS ni tuer WallpaperAgent pour forcer le test.
Pour arrêter, sélectionner son ancien fond dans Réglages ; fermer l'hôte seul
n'arrête pas nécessairement une extension hébergée par macOS.

Pour reconstruire un paquet indépendant :

```sh
bash pocs/macos-native-wallpaper/prepare.sh --package
```

Le script affiche le nouveau chemin ; il ne l'enregistre pas automatiquement.
Le paquet courant a été enregistré explicitement avec `pluginkit -a` sur son
`.appex`. La requête `pluginkit -m -A -D -v -i org.wallpaperthemes.nativeprobe.extension`
renvoie **1 plug-in** à ce chemin. Ceci valide sa présence au registre, pas son
affichage dans les réglages, son lancement XPC ou l'animation réelle.
Ne pas déplacer le build courant avant le test. Aucune sélection de fond n'a été faite.

## Isolation et contrôles du paquet

L'hôte est original ; l'extension réutilise Phosphene MIT à la révision ci-dessous.
Le paquet conserve la licence. Identités propres `org.wallpaperthemes.nativeprobe`
et `.extension`. Signature locale ad hoc validée par `codesign --verify --strict`
sur l'extension et `--deep --strict` sur l'application ; aucune notarisation revendiquée.
Les deux plist passent `plutil -lint`. Le code hôte a été exécuté seulement dans
son mode de génération de miniature, sans interface ni modification du fond.

Le build `--package` exclut VideoLibrary et SpiralRecovery amont. Leur remplacement
ne scanne, n'importe, ne migre et ne supprime aucun média ; la miniature est une
ressource originale du paquet. Aucun signal de récupération ne redémarre l'agent.
Les ouvertures d'applications externes de l'extension sont neutralisées, les
notifications sont renommées, les contrôles XPC échouent fermés. L'extension reste
sandboxée, sans entitlement réseau. Des préférences/caches/logs propres peuvent
être créés par le reste du code amont dans son conteneur, pas dans celui de Phosphene.
La sandbox, la sélection et les transitions restent à observer au lancement réel.

Validation de cette étape : deux builds de paquet réussis (le dernier inclut
les refus XPC), signatures vérifiées, sandbox présente dans la signature et
miniature PNG générée. `npm run verify` réussi : 262 tests du socle réussis,
un ignoré, zéro échec ; trois tests MCP réussis ; audit npm sans vulnérabilité.
Syntaxes Bash/Node vérifiées et argument inconnu refusé avant build (code 64).
Le clone amont, AGENTS.md, CLAUDE.md et hooks Codex restent inchangés.
Ces vérifications ne sont pas un test visuel de l'extension.

Archify documente la frontière `.app`/`.appex` : architecture showcase 9/9,
zéro erreur/avertissement, aucune correction géométrique pour cette mise à jour.
Source SHA-256 `bf8fba72d829337de3a0288f7dda17c1820285a491c8719fb36b7ecbf16ae0aa` ;
HTML SHA-256 `6c00b3d74673a99936f13a9ccd368bc75de02effc9c04b7f8ce8225dc343629e`.
Quatre tailles desktop sans débordement ; capture sombre 2048×1320 inspectée
par l'agent. Revue humaine du reçu automatique `pending`, interface fixe anglaise.

Les sections suivantes archivent l'étape de compilation simple, qui reste disponible
sans argument et ne doit pas être lancée directement comme extension.

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

Reçu historique du schéma avant packaging : architecture showcase 9/9, zéro erreur/avertissement,
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
