# Sonde native macOS — paquet local de test

## Build interactif séparé — 8 septembre 2026

L'utilisateur confirme l'animation du build 3. Son processus PID 12860 et son
enregistrement restent intacts. Le dernier paquet préparé est
`dist/pocs/macos-native-wallpaper/compile.13L9I5/Native Wallpaper Probe.app`.
Identités indépendantes `org.wallpaperthemes.nativeprobe.interactive` et
`org.wallpaperthemes.nativeprobe.interactive.extension`, version 6. Signature et
plist validées. Hôte enregistré par
`lsregister -f`, extension par `pluginkit -a` ; le fond actif n'a pas été changé
et ce nouveau binaire n'a pas encore été lancé. L'ancien compagnon build 5
`compile.Bbw4WZ` reste le seul processus hôte interactif observé au moment de
cette mise à jour ; il ne lit pas le dernier manifeste.
Le premier assemblage HJrJSV, antérieur à la mise à jour de l'identité hôte,
n'a pas été enregistré et ne doit pas être utilisé.

Pour tester le nouveau paquet : ouvrir **ce chemin 13L9I5** dans Finder ; le
compagnon présente ses commandes et un bouton vers les Réglages. Choisir
**Native Wallpaper Interactive → Balayage interactif** uniquement pour ce test.
Conserver **Native Wallpaper Probe** comme retour au build 3 déjà observé.
Les deux catalogues ont une vignette similaire, mais des fournisseurs distincts.
Fermer le compagnon ne termine pas le wallpaper hébergé par macOS.

Fonctions implémentées : panneau dans les calques du décor, pause/reprise du
balayage sans réinitialiser sa phase, effet de contour lumineux, fermeture du
panneau, reset des états visuels et sept objets de contrôle dessinés dans le
panneau. Commandes via boutons AppKit dans une fenêtre
ordinaire du compagnon. Cette fenêtre n'est ni un overlay permanent de bureau,
ni le wallpaper lui-même. L'observation globale souris/clavier n'est pas ajoutée.
Les objets du panneau sont visuels : les clics directs et le filtrage Finder
restent une preuve séparée, non implémentée dans ce build.

`interactive-theme.json` constitue le premier asset de composition partagé par
l'hôte et l'extension. Son schéma compagnon fixe l'identité, les couleurs, la
cinématique, le panneau, les actions et trois ancres de décor avec leurs cadres
normalisés. Le chargeur Swift applique en plus les invariants croisés que JSON
Schema ne garantit pas ici :
cadres entièrement contenus et non superposés, références d'actions valides,
sept commandes exactes et unicité des identifiants.
Un asset invalide n'est ni rendu ni présenté comme choix utilisable.

La transmission utilise sept notifications Darwin nommées sans payload,
idempotentes mais non authentifiées et sans garantie de livraison. Aucun shell,
fichier utilisateur, réseau ou terminal réel n'est piloté. L'UI annonce
« demande envoyée », pas « appliquée ». L'extension écrit `[Interaction] applied`
dans son conteneur propre à réception ; aucune boucle de polling supplémentaire.
L'absence de récepteur doit laisser le compagnon utilisable sans attendre.

Validation native : `bash pocs/macos-native-wallpaper/test.sh` réussit, 22
assertions commandes/états, 14 assertions d'asset, 6 assertions de hit-testing
et 15 assertions sur les calques (pause idempotente, reprise, effet, reset,
panneau unique, contrôles et ancres bornés, taille réduite), soit 57 contrôles.
Le manifeste passe aussi son JSON Schema Draft 2020-12. Dispatch direct de test,
pas de message envoyé au wallpaper actif et pas de fenêtre de test visible.
Ces tests ne prouvent pas le transport Darwin à travers la sandbox, le rendu
du panneau par WallpaperAgent ni un clic réel. Le build complet `compile.13L9I5`
réussit avec deux avertissements amont déjà présents ; aucune notarisation revendiquée.
Le snapshot reste une image de diagnostic fixe et ne reflète pas les nouveaux
états interactifs : transitions, mise en veille et énergie restent à qualifier.
Le même test produit une capture PNG 1200×780 hors écran ; sa revue visuelle
confirme le panneau, les sept contrôles et les trois ancres sans troncature.
`npm run verify` réussit également ; syntaxes Bash/Node et diff vérifiés.
AGENTS.md, CLAUDE.md, hooks et clone amont inchangés ; aucun fichier supprimé.

Archify architecture : 9/9 showcase, zéro erreur/avertissement, deux corrections
ciblées de placement/routage. Source SHA-256
`2d25f6a8e9d9168560d0aae55b042619bec12a083b3ff77c5b5e01fe58014845` ; HTML
`0b9cc597d1cff67b2d61331bbb15496da33ff6e7cb1bf19dd9ab9a22381f05a4`.
Artefact `dist/architecture/macos-native-wallpaper.architecture.html` ; quatre
tailles sans débordement, capture sombre 2048×1320 inspectée : hiérarchie,
relations et libellés lisibles, sans collision visible. Revue visuelle réussie
après deux corrections ciblées de placement/routage. Libellés français, interface fixe du
visualiseur en anglais.

## Paquet animé précédent conservé

Le paquet actuellement enregistré et relancé est
`dist/pocs/macos-native-wallpaper/compile.nXn2Mw/Native Wallpaper Probe.app` (build 3).
Le build 4 `compile.aGAdKG` reste conservé mais non enregistré après le retour
ciblé ci-dessous ; ne pas le réenregistrer pendant la qualification visuelle.
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
doit identifier ce chemin. La présence dans Réglages et le lancement XPC ont été
observés sur le build 2 corrigé, mais pas l'animation correcte. L'utilisateur a
sélectionné le diagnostic, puis signalé un fond noir. Ne pas déplacer le build courant.

## Correction du démarrage et du noir — 7 septembre 2026

### Contre-vérification après nouvelle sélection utilisateur

**Résultat du retour ciblé, 23:57 :** après validation de sa signature, l'hôte
build 3 nXn2Mw et son extension ont été réenregistrés. L'enregistrement pluginkit
du build 4 a été retiré (fichiers conservés). Le registre ne contient alors
qu'une extension du projet. Navigation Computer Use Apparence → Fond d'écran :
le processus PID 12860 est lancé depuis nXn2Mw ; à 21:57:29.800Z son journal
confirme `[colorDiag] installed sweep on display 1 (1512x982)`, puis des requêtes
UPDATE. Aucun service Apple ni processus de diagnostic n'a été arrêté pendant
ce retour. Le lancement est donc rétabli ; ce n'est pas encore une confirmation
visuelle d'animation. L'utilisateur est invité à observer le bureau actuel,
sans refaire une sélection. L'erreur de snapshot PNG/AVFoundation du build 3
reste présente. Garder cette version vivante jusqu'à la revue visuelle.

**Piste boutons non implémentée :** un moniteur souris dans un hôte distinct
pourrait observer les clics sans fenêtre wallpaper superposée. L'[API Apple
NSEvent](https://developer.apple.com/documentation/appkit/nsevent/addglobalmonitorforevents(matching:handler:))
ne fournit que des copies asynchrones et ne bloque pas leur destinataire.
Cela ne résout pas à lui seul la priorité des icônes Finder, le filtrage des
autres fenêtres ou la liaison sécurisée à l'extension sandboxée. Ne pas activer
de surveillance globale ni demander des droits d'accessibilité sans cadrer
ce test séparé et ses limites. Aucun bouton/panneau fonctionnel n'est livré ici.

L'utilisateur rapporte qu'une version animait le fond, puis que l'animation a
disparu. La resélection ne résout pas le défaut. Les journaux système à 23:50
montrent des tentatives de lancement suivies de
`ExtensionFoundation/EXRunningExtension.swift:92: Fatal error: Invalid bundle record for current process`.
Le rapport local `NativeWallpaperProbe-2026-09-07-234858.000.ips` identifie le
build 3 et SIGTRAP dans `_EXRunningExtension._start`, avant le diagnostic.
Le chemin effectivement lancé reste `compile.nXn2Mw`, alors que pluginkit
référence le build 4 `compile.aGAdKG`. L'absence de processus vivant ne signifie
donc pas que macOS n'a pas tenté de relancer l'extension.

L'hôte build 4 a été réenregistré avec `lsregister -f` (cette application seule),
puis son extension avec `pluginkit -a`. Aucun service Apple n'a été redémarré.
Le nouveau registre pointe sur aGAdKG ; ce contrôle ne prouve pas la résolution
du crash. Computer Use voit le diagnostic sélectionné, mais ses tentatives de
clic échouent (`cannotClickOffscreenElement`, puis `noWindowsAvailable`).
Le dernier journal applicatif reste celui du build précédent ; animation et
reprise restent non validées. Ne pas multiplier les builds avant de vérifier
le chemin réellement lancé et la disparition de l'assertion.

Les boutons demandés restent non implémentés dans cette extension : le protocole
XPC inspecté ne fournit pas de route souris vers la scène. Dessiner des boutons
ne suffit pas ; une route d'entrée préservant les icônes Finder doit être prouvée
avant de déclarer les actions, panneaux et effets interactifs fonctionnels.
Une fenêtre superposée ne constitue pas un repli accepté par l'utilisateur.

Trois défauts distincts ont été isolés, sans redémarrer WallpaperAgent ou Finder :

1. Le binaire ordinaire utilisait `_main`. La spécification locale Xcode
   `DarwinProductTypes.xcspec` attribue `_NSExtensionMain` aux produits app-extension,
   dont hérite extensionkit-extension. Le linker du paquet reprend désormais
   ce point d'entrée. Avec le build 2 (`compile.icGI0X`), le journal passe de
   l'erreur XPC 4099 à `END provideSettingsViewModels` et Computer Use confirme
   l'entrée **Native Wallpaper Probe / Balayage diagnostic** dans Réglages.
2. `git apply` exécuté depuis l'export imbriqué sautait le chemin du patch sans
   échouer. Le build remplace cet appel par `patch -p1 -d <copie>` puis exige
   la présence du drapeau dans ColorDiag.swift. Le build 3 (`compile.nXn2Mw`)
   journalise réellement `[colorDiag] installed sweep`, contrairement aux précédents.
3. Les snapshots de ce diagnostic passaient le PNG à AVAssetImageGenerator,
   produisant `AVFoundation -11828`. Le build 4 décode le PNG via ImageIO et
   réutilise `renderSnapshotToIOSurface`. Il installe également les calques avant
   de répondre à la première acquisition du contexte.

La signature et la compilation du build 4 réussissent ; sa sélection et ses
snapshots réels restent à confirmer. La tentative GUI de recliquer a échoué
(`cannotClickOffscreenElement`, puis `noWindowsAvailable`). Une sélection par
l'utilisateur est demandée ; ne pas annoncer le fond noir résolu sans observation.
Les fichiers des anciens builds sont conservés. Leurs enregistrements obsolètes
ont été retirés au profit du dernier. Seul le processus de test PID 53800, dont
le chemin avait été vérifié, a reçu SIGTERM pour permettre un rechargement.

Contrôles : `npm run verify` réussi (262 tests réussis, un ignoré, aucun échec ;
trois tests MCP réussis ; audit npm sans vulnérabilité). Le mode sans argument
recompile aussi : une régression Bash 3.2 sur tableau vide avec `set -u` a été
corrigée en explicitant `_main` pour ce mode. Diff et syntaxes vérifiés, clone
amont et hooks inchangés. Archify précise le snapshot PNG et son IOSurface,
sans nouvelle frontière ou nouveau contrat système.

Documentation consultée : [point d'entrée AppExtension Apple](https://developer.apple.com/documentation/extensionfoundation/appextension/main%28%29-5zfjx).
Un [signalement CodexBar](https://github.com/steipete/CodexBar/issues/1095) présente
un symptôme analogue ; ce n'est pas la preuve du correctif, qui repose ici sur
la spécification Xcode locale et les résultats XPC/UI observés.

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
Les transitions et la consommation restent à observer ; l'entrée a été lancée
par WallpaperAgent, mais le rendu final n'est pas encore qualifié.

Validation de cette étape : deux builds de paquet réussis (le dernier inclut
les refus XPC), signatures vérifiées, sandbox présente dans la signature et
miniature PNG générée. `npm run verify` réussi : 262 tests du socle réussis,
un ignoré, zéro échec ; trois tests MCP réussis ; audit npm sans vulnérabilité.
Syntaxes Bash/Node vérifiées et argument inconnu refusé avant build (code 64).
Le clone amont, AGENTS.md, CLAUDE.md et hooks Codex restent inchangés.
Ces vérifications ne sont pas un test visuel de l'extension.

Archify documente la frontière `.app`/`.appex` : architecture showcase 9/9,
zéro erreur/avertissement, aucune correction géométrique pour cette mise à jour.
Source SHA-256 `3cbe78123d6f26b5ce78142a61e7b647bc8884078c013ccbab730f1f317f6040` ;
HTML SHA-256 `6920b07465447501841905405ab91dd4562f3677d6e0f965d7001589cdc150e3`.
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
