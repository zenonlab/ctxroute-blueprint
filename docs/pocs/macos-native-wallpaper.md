# Sonde native macOS — paquet local de test

> **Gelé le 8 septembre 2026.** Ce paquet démontre le chargement et le rendu d'un
> provider local, mais son panneau dessiné dans le décor coexiste avec le panneau
> AppKit du compagnon. Cette duplication est une limite connue du PoC1. Le PoC2 repart
> d'un manifeste canonique et d'un panneau logique unique ; voir
> [la spécification](macos-connector-poc2.md).

## Version 12 — scène épurée, 8 septembre 2026

La version 12 retire les trois ancres purement diagnostiques « Objet terminal »,
« Orbe lumineux » et « Borne reset ». Elles n'appartenaient pas au modèle de course
et donnaient l'impression que le package contenait déjà un terminal. Le wallpaper
conserve la piste, les quatre véhicules, leurs animations et les effets internes.
Le schéma accepte maintenant une liste d'ancres vide ; les actions du panneau restent
disponibles au compagnon sans produire d'objets décoratifs artificiels.

Preuves isolées : 16 contrôles d'asset, 6 contrôles de hit-test, 21 contrôles de
calques, trois rendus distincts et 19 contrôles du package signé. Le build préparé est
`dist/pocs/macos-native-wallpaper/compile.tKxmve/Native Wallpaper Probe.app`.
Une copie locale stable est installée dans
`~/Applications/Wallpaper Themes/Native Wallpaper Interactive.app`. Après
réenregistrement du provider et rafraîchissement de Réglages/WallpaperAgent, la section
**Native Wallpaper Interactive** et sa tuile **Balayage interactif** ont été observées
et la tuile est sélectionnée. L'extension active provient de cette copie stable ; les
chemins temporaires de compilation ne constituent plus la source enregistrée.

## Version 11 — véhicules dans le wallpaper, 8 septembre 2026

Après constat que la première couche AppKit dessinait les véhicules devant Finder,
la version 11 déplace tous leurs pixels dans `InteractiveDiagnostic`, au sein de
l'extension native. Le thème externe décrit une piste elliptique et quatre véhicules
de sessions ; Core Animation possède leurs trajectoires, orientations et pause.
Le compagnon séparé ne dessine aucun objet : son `CGEventTap` synchronisé sur l'uptime
monotone effectue le hit-test au clic et ouvre un panneau natif après sélection.

Les validations isolées passent : 18 contrôles d'asset, 21 contrôles de calques
incluant les quatre animations, trois snapshots 1200×780 distincts et 19 contrôles
du package signé. Le build final est
`dist/pocs/macos-native-wallpaper/compile.znNVe4/Native Wallpaper Probe.app`.
Il est enregistré et sa tuile apparaît dans Réglages. Computer Use n'a pas réussi
à presser cette tuile (`cannotClickOffscreenElement`, puis `noWindowsAvailable`) :
la sélection et le rendu composé de **ce build final** ne sont pas revendiqués.

Le build intermédiaire `compile.FF4Nag`, qui contenait déjà le rendu natif des
véhicules avant l'alignement final de l'horloge, a été lancé par WallpaperAgent et
a créé deux contextes 1512×982. Sa revue hors écran montre la piste et les véhicules.
Le clic matériel, la correspondance exacte des hit-boxes et la priorité d'une icône
Finder superposée restent des preuves manuelles. La version 10 ci-dessous demeure
historique et son chemin n'est plus le provider enregistré.

## Build interactif séparé — 8 septembre 2026

L'utilisateur confirme l'animation du build 3. Son ancien processus d'extension
a été arrêté le 8 septembre pour isoler le test suivant, sans supprimer son
paquet. Le dernier paquet préparé est
`dist/pocs/macos-native-wallpaper/compile.9n1Dga/Native Wallpaper Probe.app`.
Identités indépendantes `org.wallpaperthemes.nativeprobe.controls` et
`org.wallpaperthemes.nativeprobe.controls.extension`, version 10. Signature et
plist validées. Hôte enregistré par `lsregister -f`, extension par `pluginkit -a`.
Le compagnon PID 64966 et l'extension PID 64974 sont lancés. `Index.plist`
référence le provider `controls`, la scène 2222… et la sélection
`Balayage interactif`. Son chemin de miniature demeure celui du paquet v9
PKkhnQ choisi à 07:45:33 ; le provider v10 enregistré dessert ensuite ce choix.
Les anciens compagnons `compile.g74ecK` (PID 43344) et `compile.Bbw4WZ`
(PID 72671) restent les processus hôtes interactifs observés au moment de cette
mise à jour ; ils ne lisent pas le dernier manifeste. Aucun ancien fichier n'a
été supprimé.
Le premier assemblage HJrJSV, antérieur à la mise à jour de l'identité hôte,
n'a pas été enregistré et ne doit pas être utilisé.

Pour tester le nouveau paquet : ouvrir **ce chemin 9n1Dga** dans Finder ; le
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

L'interface XPC de Phosphene épinglée ne contient aucun callback de pointeur.
Apple documente le moniteur global `NSEvent` comme un observateur de copies
asynchrones incapable de modifier la livraison originale. Le prochain adaptateur
macOS devra donc combiner observation et classification sûre de la cible Finder ;
en l'absence de preuve ou d'autorisation requise, il devra refuser l'intention.

Le paquet compile maintenant un premier classificateur macOS en lecture seule.
Il ne demande pas l'autorisation Accessibilité et n'installe aucun moniteur global.
Lorsque l'autorisation existe déjà, sa sonde peut utiliser
[`AXUIElementCopyElementAtPosition`](https://developer.apple.com/documentation/applicationservices/1462077-axuielementcopyelementatposition)
pour décrire l'élément supérieur. Seule une signature de fond Finder mesurée puis
ajoutée à une liste explicite peut rendre l'emplacement admissible au wallpaper.
Cette liste est vide dans le paquet : absence de permission, échec de sonde,
application tierce, icône Finder et signature inconnue refusent tous l'intention.
Le classificateur n'est pas encore relié au hit-tester ni exécuté au démarrage.
Dans le contexte de développement déjà autorisé, une sonde ponctuelle sans noms
de fichiers observe le fond Finder comme
`AXGroup → AXScrollArea → AXApplication` et les icônes comme
`AXImage → AXGroup → AXScrollArea → AXApplication`. Cette mesure prouve que les
deux cibles sont distinguables sur cette session macOS 26.2. La pression AX de
la tuile v9 fait planter le panneau Apple
avant l'acquisition d'une surface ; aucune signature n'est donc promue en
production.

`interactive-theme.json` constitue le premier asset de composition partagé par
l'hôte et l'extension. Son schéma compagnon fixe l'identité, les couleurs, la
cinématique, le panneau, les actions et trois ancres de décor avec leurs cadres
normalisés. Le chargeur Swift applique en plus les invariants croisés que JSON
Schema ne garantit pas ici :
cadres entièrement contenus et non superposés, références d'actions valides,
sept commandes exactes et unicité des identifiants.
Un asset invalide n'est ni rendu ni présenté comme choix utilisable.

La transmission utilise sept requêtes Darwin et sept quittances nommées sans
payload, idempotentes mais non authentifiées et sans garantie de livraison. Aucun shell,
fichier utilisateur, réseau ou terminal réel n'est piloté. L'UI annonce
« en attente », puis « appliqué par le wallpaper » seulement après quittance.
L'extension écrit `[Interaction] applied` dans son conteneur propre avant la
quittance ; aucune boucle de polling supplémentaire.
L'absence de récepteur doit laisser le compagnon utilisable sans attendre.

Validation native : `bash pocs/macos-native-wallpaper/test.sh` réussit, 34
assertions commandes/quittances/états, 14 assertions d'asset, 6 assertions de hit-testing,
8 assertions de priorité macOS et 17 assertions sur les calques (pause
idempotente, reprise, effet, reset, panneau unique, contrôles et ancres bornés,
ancres toujours visibles, sélection soulignée et taille réduite), soit 79 contrôles.
Le manifeste passe aussi son JSON Schema Draft 2020-12. Dispatch direct de test,
pas de message envoyé au wallpaper actif et pas de fenêtre de test visible.
Ces tests ne prouvent pas le transport Darwin à travers la sandbox, le rendu
du panneau par WallpaperAgent ni un clic réel. Le build complet `compile.9n1Dga`
réussit avec deux avertissements amont déjà présents ; aucune notarisation revendiquée.
Son hôte porte le SHA-256
`5b54283e08cb6e82844c881318a921b4a053e2cfd243fab8e12fba85fc12ae64` et son
extension `fca18f511ef32a59559badc20f6f8cf802d895ce02a5045e98bc395fd86235ac`.
LaunchServices et pluginkit référencent ce chemin unique pour l'identité
`controls` ; les anciens enregistrements interactifs ont été retirés sans
supprimer leurs paquets. Le compagnon PID 64966 et l'extension PID 64974 ont été
observés depuis 9n1Dga après interrogation du catalogue par macOS.

Le journal v10 prouve deux contextes actifs pour l'écran 1, chacun en 1512×982,
avec installation de `colorDiag` et mises à jour `default`/`idle`. Un clic réel
sur le bouton compagnon « Ouvrir » a produit `[Interaction] applied showPanel
roots=2`, puis l'UI a affiché « Appliqué par le wallpaper : Ouvrir. ». Les
transitions pause, effet actif, reprise et reset ont ensuite toutes été
appliquées à deux racines et la dernière quittance affichée. Cela qualifie le
transport bidirectionnel et la mutation des calques du renderer actif ; cela ne
qualifie toujours pas les clics directement dans le décor.
Cette preuve est rejouable sans mutation avec :

```sh
bash pocs/macos-native-wallpaper/verify-runtime.sh \
  'dist/pocs/macos-native-wallpaper/compile.9n1Dga/Native Wallpaper Probe.app'
```

Le gate passe 8 contrôles sur le PID 64974 : chemin isolé, enregistrement du
provider, processus issus du paquet, sélection provider/scène, initialisation du
PID, deux surfaces et cinq commandes appliquées. Il refuse les arguments absents
avec le code 64 et les chemins externes avec le code 65.

Le candidat g74ecK a été lancé et sa fenêtre AppKit, ses sept boutons ainsi que
l'état « demande envoyée » ont été observés. Les Réglages ont affiché le groupe
`Native Wallpaper Interactive`, mais avec l'ancienne tuile
`Balayage diagnostic`. Sa sélection a laissé le bureau blanc et n'a lancé aucun
processus d'extension g74ecK. Les journaux WallpaperAgent indiquent la fusion de
groupes portant le même identifiant ; la copie amont réutilisait en effet
`video-wallpapers`. ZJRqMF a introduit l'identifiant
`native-wallpaper-interactive`, mais conservait `CFBundleVersion` 6. Une lecture
des Réglages après réenregistrement montrait encore le modèle mis en cache.
Zl05p9 conserve le groupe propre, passe le couple hôte/extension à la version 7
et vérifie ces deux invariants pendant le build. Il a été compilé et enregistré,
mais pas sélectionné, puis retiré du registre sans supprimer son paquet. ny9wmI
introduit ensuite le catalogue version 8 et révèle deux défauts du premier gate
Bash. sZMB0b est le premier assemblage version 8 à terminer toute la chaîne avec
les 18 contrôles corrigés et la visibilité stable des ancres. Son lancement a
confirmé que le choix actif restait lié à l'ancien provider build 3. PKkhnQ
emploie donc une nouvelle identité provider/groupe et la version 9 pour isoler
le cache sans supprimer le choix historique.

`verify-package.sh` permet de rejouer la qualification statique sur un paquet
déjà construit sans l'exécuter. 9n1Dga passe ses 19 contrôles : emplacement isolé,
binaires présents, plist, identités, versions, extension point, manifeste et
schéma identiques entre l'hôte et l'extension, miniature 480×270, nom/UUID de
scène, identifiant de groupe et canal de quittance compilés, signatures et sandbox.
Le vérificateur refuse un chemin extérieur au répertoire de builds du PoC et
exige que la sandbox soit l'unique entitlement de l'extension.
Le gate emploie des refus explicites, car Bash 3.2 ne propage pas `errexit` pour
une expression `[[ ... ]]` fausse dans cet environnement. Le paquet version 7
est désormais refusé avec le code 66 ; un chemin extérieur reste refusé avec 65.
Après enregistrement puis lancement de sZMB0b, Réglages Système affichait encore
`Native Wallpaper Interactive → Balayage diagnostic` et `Index.plist` pointait
vers nXn2Mw. Le nouvel identifiant v9 a forcé une seconde interrogation :
Réglages affiche alors une entrée indépendante `Balayage interactif` et lance
l'extension PKkhnQ. Lors du premier essai automatisé, cela qualifiait la
découverte du provider, pas encore son activation. Un `sky.click` par index
Accessibilité sur la nouvelle tuile a fait planter
`com.apple.Wallpaper-Settings.extension` PID 77876 dans
`AccessibilityButtonModifier` / `accessibilityPerformPress`, rapport
`Wallpaper-2026-09-08-015333.ips`. Aucune trame `ACQUIRE` du renderer n'est
observée et `Index.plist` restait inchangé : ce crash appartient au chemin de
pression AX du panneau Apple, avant la création de surface. Les clics coordonnés
de l'automatisation n'ont pas activé la tuile. Une sélection ultérieure à
07:45:33 a inscrit le provider `controls` et le chemin PKkhnQ dans `Index.plist`,
puis créé deux surfaces. Le défaut AX est donc distinct du renderer, maintenant
qualifié par l'activation v9 puis par l'exécution v10.
La miniature du catalogue reste une image de diagnostic fixe et ne prouve pas
les nouveaux états interactifs : clics dans le décor, mise en veille et énergie
restent à qualifier. Le test hors écran produit trois captures PNG 1200×780 : repos, panneau
actif, puis panneau avec animation en pause et effet actif. Le test exige trois
fichiers valides et byte-à-byte distincts ; leur revue visuelle confirme les
transitions, les sept contrôles et les trois ancres sans troncature. Les ancres
restent opaques dans tous les états ; une bordure renforcée indique l'objet actif
sans faire disparaître les autres objets du décor.
`npm run verify` réussit également ; syntaxes Bash/Node et diff vérifiés.
AGENTS.md, CLAUDE.md, hooks et clone amont inchangés ; aucun fichier supprimé.

Archify architecture : 9/9 showcase, zéro erreur/avertissement. Source SHA-256
`466b11eee9aada76b7138f096428b85bacbe293b58407381c10d8afa516abf1c` ; HTML
`e944a4906406cd677f210bcf1b440f8ba1925faf2297100c6724a8257cab7cb1`.
Artefact `dist/architecture/macos-native-wallpaper.architecture.html` ; quatre
tailles sans débordement, capture sombre 2048×1320 inspectée : hiérarchie,
relations, gate statique, cache de catalogue, requêtes et quittance lisibles,
sans collision visible. Libellés français, interface fixe du visualiseur en anglais.

## Paquet animé précédent conservé

Le paquet historiquement enregistré et relancé lors de cette preuve était
`dist/pocs/macos-native-wallpaper/compile.nXn2Mw/Native Wallpaper Probe.app` (build 3).
Son extension n'est plus enregistrée ni active depuis l'isolation de v9 ; ses
fichiers restent conservés.
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
