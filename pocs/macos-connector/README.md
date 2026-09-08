# Connecteur macOS — PoC 2

Une app AppKit de contrôle, une extension wallpaper native, un catalogue original.
Pas de fenêtre de décor superposée, de terminal PTY, de ROM ou de WebView.
Le PoC1 reste intact. Les gestes macOS sont soumis à Accessibilité et à une
classification conservatrice du fond Finder ; aucun réglage modifié au lancement.

## Fichiers du bureau — correctif du 8 septembre 2026

L'utilisateur confirme les interactions du build installé `g9pTbH`, sauf le bouton
Fichiers : celui-ci ouvrait seulement les Réglages. Le correctif raccorde cette
intention à `App/DesktopItems.swift`, dans l'agent, sans nouveau message XPC.
Il modifie `com.apple.WindowManager/StandardHideDesktopIcons` via CFPreferences,
uniquement après clic. L'état est relu avant chaque bascule et après synchronisation.
Le menu Orbite dispose d'un toggle et d'une commande **Réafficher les fichiers du
bureau**, indépendants du hit-test du wallpaper. Aucun fichier n'est lu, déplacé,
supprimé ni modifié. Aucun redémarrage Finder/Dock ni polling n'est ajouté.

Le PoC1 utilisait `CreateDesktop` puis redémarrait Finder, comme le fait
[OnlySwitch](https://github.com/jacklandrin/OnlySwitch/blob/main/Modules/Sources/Switches/ShellCommandDefine.swift).
Ce chemin n'est pas repris : retirer le bureau Finder peut retirer la cible AX
positive nécessaire aux clics du PoC2. Le nouveau réglage reste une préférence
macOS non contractuelle, qualifiée seulement sur MAC-01 : la case native « Sur le
bureau » est passée de 1 à 0 puis 1 lors de l'essai ; une écriture directe a aussi
mis cette case à 0. `CreateDesktop` est resté à 1 ; Finder n'a pas été redémarré.
Affichage initial rétabli. Cela confirme le réglage, **pas encore le cycle visuel
masquer/réafficher par le bouton du nouveau paquet** ni la conservation du hit-test.

Si Stage Manager est actif ou si un autre outil a déjà mis `CreateDesktop=false`,
l'action échoue explicitement et le diagnostic propose les Réglages : elle ne
change pas ces politiques à l'insu de l'utilisateur. Les neuf cas injectés de
`test-native.sh` couvrent bascules, restauration, changement externe, refus de
synchronisation, absence de quittance et ces deux restrictions. L'icône reste
neutre : le réglage observé n'est pas une preuve d'état visuel du compositeur.

## Personnalisation locale — 8 septembre 2026

Correction du verrou d'édition : une fenêtre de personnalisation déjà ouverte
n'interdit plus les lancements ni les deux contrôles fixes. Un nouveau clic droit
rappelle le brouillon existant et active son application, sans remplacer les valeurs
non enregistrées ; la fenêtre peut rejoindre le Space actif. Pour éditer un autre
objet ou en ajouter un, terminer d'abord le brouillon par Enregistrer ou Annuler.
Le filtre Finder, la géométrie, les permissions et le transport restent inchangés.
La fenêtre native restée ouverte a été observée pendant le défaut ; cette correction
ne constitue pas à elle seule une qualification des clics sur objets animés.

Correctif du filtre Finder : l'élément directement pointé doit correspondre à
`AXGroup → AXScrollArea → AXApplication`, signature mesurée dans le premier PoC
([preuve](../../docs/pocs/macos-native-wallpaper.md)). L'ancien filtre exigeait
`AXScrollArea` et rejetait cette cible avant le hit-test du thème. Une icône
`AXImage`, un groupe dans une fenêtre ou une application tierce restent refusés ;
aucune remontée depuis une icône vers un ancêtre admissible. Les rectangles des
enfants gardent la priorité, et les erreurs AX restent non interactives.
`test-native.sh` compile le vrai adaptateur et vérifie neuf cas de hiérarchie,
sans lire ni manipuler le bureau. Ce test ne remplace pas la qualification native.
Le lancement explicite `--diagnostics` trace au maximum 32 décisions de capture,
filtrage et émission d'intention ; aucune coordonnée, aucun nom de fichier ou ID
d'objet n'est journalisé. Le lancement normal n'active pas ces traces.

Voir [ADR-0054](../../docs/decisions/ADR-0054-macos-theme-interaction.md).
Le clic **droit** ouvre une fenêtre de personnalisation centrée, pas une barre à
droite : nom, couleur, taille et application locale associée. Le clic gauche ouvre
l'application (Terminal par défaut pour les fixtures). Le clic droit sur vide
qualifié prépare un nouvel objet, limité à huit ; aucune suppression automatique.
La commande d'édition est validée et corrélée. La sauvegarde privée dans
`~/Library/Application Support/org.wallpaperthemes.connectorpoc2/themes/` suit la
quittance ; Annuler avant envoi ne modifie rien. Les ressources signées restent intactes.

Le provider peint les deux contrôles du manifeste dans ses calques natifs. `Son`
modifie uniquement l'état muet du thème : les fixtures restent silencieuses et
aucun volume système ne change. `Fichiers` appelle le contrôleur macOS ci-dessus ;
la qualification visuelle du nouveau paquet reste requise.
Le menu de récupération du connecteur permet aussi l'édition d'un objet.
Aucun panneau ne s'ouvre au lancement normal.

Présentation corrigée : deux boutons carrés 40×40, espace 8 points, icônes seules
24×24 adaptées de [Lucide 0.468.0](https://github.com/lucide-icons/lucide/tree/0.468.0/icons).
`volume-x`/`volume-2` suivent l'état muet du thème ; `files` reste neutre tant que
l'état Finder n'est pas observé. Tracés CAShapeLayer, pas de WebView, police d'icônes
ou chargement réseau. Licence dans chaque paquet signé. La zone de clic provient
du même `ThemeLayout.control` que le dessin. Le test vérifie les dimensions, l'écart,
l'absence de texte, l'échelle Retina et les deux états audio.

`ThemeLayout` partage les 128 segments de trajectoire entre animation et hit-test.
Chaque surface publie son écran, sa taille, son horloge et son état actif, sans
polling par trame. Deux surfaces natives du même écran ne sont acceptées que si
leurs hit-tests désignent le même objet/contrôle/vide dans le même thème ; sinon
l'entrée reste native. Les écrans ou surfaces ambigus restent non interactifs. Les
fenêtres, icônes et descendants Finder gardent la priorité ; les glissers sont
annulés, les actions sont différées hors du callback souris. Cette politique
nécessite encore la qualification native des superpositions et des Spaces.

Preuves automatisées : 30 XCTest, Swift 6 strict, catalogue natif et signatures.
L'autorisation TCC de l'agent installé était absente pendant la première inspection.
Ne pas confondre ces preuves avec un test réussi de clic droit sur le bureau.
Le reste de ce document conserve explicitement les états historiques antérieurs.

### Comparaison ciblée avec le PoC1

Correctif de récupération du 8 septembre 2026 : `ActiveClickTap` réactivait un tap
désactivé, contrairement au premier `DesktopInput` du PoC2. Celui-ci vérifie désormais
l'état réel du port : actif = aucune réinstallation ; valide mais désactivé = une
tentative de réactivation avec vérification ; invalide = nettoyage puis création.
Les notifications de désactivation annulent le geste et programment cette reprise
hors du callback. Une tâche déjà programmée ne recrée pas un port après `stop()`.
La reprise exige toujours Accessibilité, écran éveillé et session active ; aucun
prompt automatique, polling, changement du filtre Finder ou nouveau calque.
Les 17 cas injectés du test natif vérifient les autorisations, l'idempotence et le
refus du système, sans fabriquer d'événements souris ni modifier TCC.

Sources primaires revérifiées pour ce correctif :

- [Apple, tapEnable](https://developer.apple.com/documentation/coregraphics/cgevent/tapenable(tap:enable:))
  documente la réactivation des taps désactivés.
- [skhd, key_handler](https://github.com/asmvik/skhd/blob/master/src/skhd.c)
  réactive le tap pour les deux notifications de désactivation. Référence de
  mécanisme, pas de gestion des icônes de bureau ; aucun code C importé.
- [Phosphene](https://github.com/kageroumado/phosphene) reste la référence déjà
  réutilisée pour le provider natif, pas une preuve de routage des clics de nos objets.
- [Plash](https://github.com/sindresorhus/Plash) annonce ne plus publier son code
  source : ne pas le présenter comme une brique actuelle intégrable.

Qualification nécessaire sur le même binaire installé et autorisé : clic son,
clic droit objet, clic droit vide, masquer/réafficher les fichiers, priorité d'une
icône Finder superposée, changement de Space, veille/reprise et relance de l'agent.
La récupération après désactivation native reste à observer : les tests injectés
ne qualifient ni TCC ni les clics réels. Le PoC reste **non validé** jusque-là.
Cette réparation est interne à l'adaptateur ; contrats inchangés. Le diagramme
annote seulement « Reprise à qualifier », sans modification de sa topologie.

`pocs/macos-surface/Sources/SurfaceProbe/SplitDesktopControls.swift` utilisait des
`NSPanel` transparents placés au-dessus des icônes, avec `acceptsFirstMouse=true`.
Le décor était dans le provider ; ces petites fenêtres recevaient les clics. Leur
qualification déclarait `icon-overlap-not-supported`. Les recopier rendrait certains
clics possibles, mais réintroduirait la superposition et les conflits Finder.
L'autre chemin, `ActiveClickTap`, utilisait déjà Accessibilité et un tap actif.

Élément réutilisé : reprise événementielle depuis `NSWorkspace` (changement d'app,
Space, veille et session), plutôt que depuis l'activation du seul agent invisible.
Le PoC2 annule le geste lors de ces transitions et retente l'installation du tap
au retour des Réglages, sans polling ni nouveau panneau. Le menu « Activer les
interactions… » demande le consentement natif uniquement après action utilisateur.

La signature locale ad hoc installée possède une exigence `cdhash` spécifique au
binaire. Une autorisation d'un ancien build ne prouve pas celle du build courant,
comme l'explique [Apple TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements/).
Ne pas reconstruire après une autorisation puis attribuer l'échec aux calques.
Aucune ancienne identité privilégiée, exception TCC ou signature affaiblie n'est
réutilisée pour éviter le consentement.

Qualification du 8 septembre, 19:06 : l'interrupteur Accessibilité peut être **on**
alors que TCC refuse le code courant (`Failed to match existing code requirement`).
L'ajout du chemin et un cycle off/on n'ont pas renouvelé cette exigence lors du
test. Ne pas confondre état des Réglages et résultat `AXIsProcessTrusted()`.
Le renouvellement par retrait/réajout de l'entrée nécessite un accord explicite.

Autre défaut observé dans le journal natif : `isChoiceDownloadedWith:reply:` doit
répondre avec `NSNumber`, pas `BOOL`, sur le macOS testé. Le pont et le handler
sont corrigés ; le build `yTrzh9` passe compilation/catalogue/signatures, mais son
installation et la nouvelle sélection réelle restent à qualifier. Le préflight
refuse de remplacer le paquet tant que le provider courant est actif.

## Historique — XPC natif, 8 septembre 2026

Le transport actif est désormais **XPC signé en mémoire**, selon
[ADR-0053](../../docs/decisions/ADR-0053-macos-provider-xpc.md). Les passages App Group
ci-dessous décrivent les sondes historiques ; le runtime ne lit plus leurs fichiers.
Le build ad hoc `build.ov2G03` est installé : inspection, pause, reprise, accentuation
et atténuation ont reçu des quittances du vrai provider macOS (deux surfaces,
révisions 1 à 6). Aucun certificat développeur utilisé. Cela ne prouve pas encore
l'effet visuel, les clics, Spaces ou la consommation. Les deux contrôles du thème
et les gestes gauche/droite restent non raccordés au bureau.

Le paquet contient trois bundles signés dans l'ordre agent → provider → lanceur.
L'agent est le connecteur, pas un démon supplémentaire. Le provider garde sa sandbox
avec une seule exception Mach lookup pour `org.wallpaperthemes.connectorpoc2.agent`.
L'agent contrôle l'UID et impose la signature du provider embarqué ; le provider impose
celle de l'agent épinglée dans ses ressources. JSON limité à 16 KiB, invariants de
commandes inchangés. Une connexion provider à la fois. Le refus d'un pair étranger
reste à tester. Après rupture, une reconnexion est tentée après 30 secondes : aucune
promesse de zéro réveil lorsque l'agent est arrêté.

Après installation, démarrer l'agent de façon persistante (ADR-0055) :

```sh
bash pocs/macos-connector/start-agent.sh '/Users/hazenawsky/Applications/Wallpaper Themes/Wallpaper Connector PoC 2.app' --persistent
```

Adapter le chemin au compte local. Le mode `--persistent` installe le job dans
`~/Library/LaunchAgents/` : demande au login, reprise après échec, starts idempotents.
Sans ce flag, une première inscription reste limitée à la session. L'agent reste sans fenêtre ;
diagnostic à la demande dans la barre des menus. Ajouter `--diagnostics` à la commande
ci-dessus uniquement pour ouvrir ce panneau technique lors d'un test. Le lanceur
extérieur sans argument démarre le job enregistré ou recharge son plist persistant
validé après « Quitter » (bootout). Un chemin, service ou argument étranger est refusé.
Pour désactiver le prochain login : décharger ce job puis déplacer son plist vers
une sauvegarde hors LaunchAgents ; ne pas supprimer les thèmes ou le paquet.
Une identité locale stable se sélectionne avec `build.sh --sign-local SHA1`.
`test-signing.sh SHA1` vérifie deux codes distincts avec le même requirement, sans
prouver TCC. `install.sh` refuse un changement d'identité sauf migration explicite
`--allow-identity-change`, qui nécessite de requalifier Accessibilité.
`--check` vérifie le manifeste, les trois signatures et l'épinglage de l'agent sans
accéder à l'App Group. Il ne prouve jamais la présence du provider : son résultat
reste `provider=unconfirmed`. Seul `--probe-mailbox` conserve la sonde historique.
Les anciens `--diagnostics`/`--smoke` s'appliquent au binaire agent avec `--agent`,
pas au lanceur extérieur. Le build normal suffit pour XPC ad hoc ; `--development`
ne sert plus qu'à autoriser les sondes historiques de groupe local.

Arrêt avant remplacement :

```sh
launchctl bootout gui/$(id -u)/org.wallpaperthemes.connectorpoc2.agent
```

L'installation refuse un job encore enregistré et conserve l'ancien paquet.
Fermer le diagnostic ne quitte pas l'agent. Le provider reste indépendant.
Swift 6 strict, signature et catalogue natif passent ; le total est de 24 XCTest.

Pour redémarrer sans panneau et sans arrêter le provider :

```sh
bash pocs/macos-connector/restart-agent.sh '/Users/hazenawsky/Applications/Wallpaper Themes/Wallpaper Connector PoC 2.app'
```

Le script valide la signature et le chemin du job avant tout arrêt. Un job provenant
d'un autre paquet est refusé ; aucun fichier supprimé ni préférence Finder modifiée.
La reconnexion du provider peut prendre 30 secondes. Le log de démarrage distingue
le mode diagnostic, l'autorisation Accessibilité du processus et l'absence actuelle
d'adaptateur de clics ; aucune permission n'est demandée automatiquement.

## Historique du transport App Group et limites de la première tranche

Le lancement normal ne montre plus de fenêtre et ne vole pas le focus : le
connecteur réside dans la barre des menus. « Diagnostic du connecteur… » ouvre
le panneau technique à la demande ; le fermer ne quitte pas le connecteur.
`--diagnostics` et `--smoke` ouvrent explicitement cette fenêtre.
Ce démarrage discret n'installe pas de service de connexion automatique et ne
sélectionne pas un wallpaper à la place de l'utilisateur. L'étagère de deux
boutons et les clics du bureau restent non raccordés, pas implicitement livrés.

Correctifs de revue : commandes et quittances testées, dernière quittance conservée
30 secondes par thème même lors d'une publication de surface. Les mailboxes de tests
n'émettent plus de notifications système ; seul `shared()` les active.
En mode strict sans Team ID, `--check` retourne 2 avant accès au groupe.
Le build explicite `--development` autorise l'essai ad hoc d'un groupe local séparé,
sans retirer la sandbox. Sur MAC-01, lecture/écriture passent dans le connecteur
et dans la sonde CLI sandboxée ; l'extension hébergée par WallpaperAgent reste
à qualifier. Ni le mode local ni la signature ne garantissent une quittance native.
Le nouveau build n'est pas installé automatiquement ; les apps historiques doivent
rester arrêtées. Aucune interface interactive, audio ou toggle Finder n'est livrée
par ce correctif. Les deux contrôles du manifeste restent des déclarations pour D1.

La politique pure `GestureRouter` traduit les gestes en intentions : ouverture à
gauche, personnalisation à droite, ajout sur vide confirmé et deux contrôles.
Elle annule les glissers, scènes périmées et permissions perdues ; les cibles
natives ou inconnues ne sont jamais capturées au début d'un geste. Le raccord
aux événements macOS et l'exécution autorisée des intentions restent absents.
Les tests synthétiques ne prouvent donc pas la priorité Finder sur le vrai bureau.

Le code compile avec Swift 6 strict ; les 21 tests XCTest passent. Les deux
bundles sont signés ad hoc et leur manifeste embarqué est identique. Ce résultat
n'est **pas** une qualification du wallpaper dans WallpaperAgent : activation,
Spaces, animation visible, commandes interprocessus et énergie restent à vérifier
sur la session graphique. L'app ne confirme une action qu'après réception d'une
quittance du provider ; un fichier d'état ancien ne prouve pas sa présence.

Build multithème du 8 septembre : `dist/pocs/macos-connector/build.jFuo52/Wallpaper Connector PoC 2.app`.
Smoke : une fenêtre et `panel_id=theme.controls`. Inspection macOS réelle effectuée :
libellés lisibles, boutons de scène désactivés quand le provider est absent ; clic
« Vérifier la connexion » sans faux succès. La capture interne `--smoke` ne restitue
pas fidèlement les boutons natifs ; elle n'est pas une preuve de leur rendu final.
Le contrôle complet du dépôt `npm run verify` passe également.

Cible de l'app et de l'extension : macOS 26, SDK local 26.5, architecture hôte.
Les tests des modules partagés ciblent macOS 14+. Aucune compatibilité avec macOS
14/15 n'est promise pour l'extension. `WallpaperExtensionKit` et `CAContext` sont
des interfaces privées : ni stabilité Apple ni distribution App Store garanties.

## Structure et propriétaire de l'état

| Répertoire | Responsabilité |
| --- | --- |
| `Sources/ThemeModel` | manifeste canonique, validation, actions, état, quittances |
| `Sources/SceneRenderer` | arbre Core Animation par surface ; aucune NSWindow |
| `Sources/ConnectorTransport` | XPC borné, signatures ; sondes fichiers historiques |
| `App` | agent XPC, diagnostic à la demande et états indisponible/en attente/confirmé |
| `Native` | catalogue Apple, surfaces, cycle de vie, validation du client XPC |
| `Native/Bridge` | déclarations et shims Phosphene, licence MIT conservée |
| `Packaging` | identités et droits du lanceur, de l'agent et du provider |
| `Tests` | modèle, idempotence, transport fichiers et arbre de calques |

Le provider possède une session d'état par `theme_id`, partagée seulement entre les
surfaces du même thème. Une acquisition porte le choix dans `descriptor.configuration`.
Lors d'un changement, le CAContext de ce WallpaperID est conservé et son arbre est
remplacé, pas empilé. Un aperçu d'un autre thème ne modifie pas cette scène.
L'app envoie des
intentions, pas des mutations directes. Redémarrer le provider remet la fixture à
son état initial avec une nouvelle identité d'instance ; aucune persistance de
préférences n'est revendiquée. Plusieurs processus providers simultanés ne sont
pas arbitrés par ce transport expérimental : ne pas qualifier ce cas par déduction.

## Construire et tester

Depuis la racine du dépôt :

```sh
swift test --package-path pocs/macos-connector --scratch-path dist/pocs/macos-connector/swift-build
bash pocs/macos-connector/build.sh
```

Le mode ci-dessus reste strict, ad hoc et sans transport partagé. Pour développer
sans certificat : `bash pocs/macos-connector/build.sh --development`.
Ce choix est compilé dans les deux exécutables, pas activable par une variable
d'environnement ou un argument au lancement. Le groupe de test est
`group.org.wallpaperthemes.connectorpoc2.local`, avec des signaux Darwin distincts.
Le runtime exige une vraie signature ad hoc et exactement ce groupe dans ses droits.
macOS reste seul décisionnaire de l'accès ; aucun droit supplémentaire n'est ajouté.

La sonde `--probe-mailbox` vérifie lecture/écriture dans le processus appelant sans
envoyer de commande. `bash pocs/macos-connector/test-sandbox-access.sh <build.app>`
copie le CLI dans un paquet de diagnostic sous `dist/`, signé ad hoc avec les droits
sandbox du provider et le groupe local. Ce n'est ni une installation ni un hébergement
par WallpaperAgent. `access-probe.json` ne contient qu'un UUID et reste dans le groupe
de test ; aucune donnée du bureau n'est lue. Les paquets de diagnostic sont conservés.

Pour préparer une preuve
signée, choisir une identité existante avec `security find-identity -v -p codesigning`,
puis passer son empreinte SHA-1 (40 caractères hexadécimaux) et son Team ID :
`bash pocs/macos-connector/build.sh --sign <empreinte> <TEAMID>`.
Les chevrons désignent des arguments à remplacer, pas une commande prête à exécuter.
L'identité doit être disponible dans le trousseau ; le script ne crée/importera aucun
certificat. Le Team ID obtenu après signature est vérifié dans les deux bundles.
Le groupe signé est `<TEAMID>.org.wallpaperthemes.connectorpoc2`, selon la
[convention macOS documentée par Apple](https://developer.apple.com/documentation/xcode/accessing-app-group-containers).
Le runtime exige exactement ce groupe dans ses droits signés. Aucun repli ad hoc
en cas d'erreur et aucune migration automatique du groupe expérimental précédent.
Le chemin signé reste non éprouvé sur cette machine faute d'identité disponible :
seule une quittance réelle du provider pourra qualifier M2-06.

Le build affiche le chemin du nouveau `.app` dans `dist/pocs/macos-connector/build.*`.
Il ne remplace aucun build, n'installe rien et ne change pas le wallpaper actif.
Il utilise uniquement le SDK Apple et les fichiers versionnés ; aucun téléchargement.
Le build exécute aussi `test-native.sh <app>` : décodage du catalogue par
`WallpaperSettingsViewModelsXPC` du macOS hôte. Le test a reproduit l'échec initial
(`sortID`, puis `shouldHideItemLabels` manquants), désormais corrigé. Une compilation
des shims seuls n'aurait pas détecté ce problème.

L'exécutable `Contents/MacOS/WallpaperConnector` accepte :

- `--check` : valide le manifeste et le prérequis de signature du transport ; ne prouve jamais une quittance du provider ;
- `--probe-mailbox` : teste lecture/écriture locale, sans toucher à `command.json`/`status.json` ni notifier le provider ;
- `--preflight-install` : refuse compagnons et providers concurrents sans les arrêter ;
- `--thumbnail <chemin.png>` : exporte la fixture, sans animer ni ouvrir une fenêtre ;
- `--thumbnails <répertoire>` : exporte une vignette par thème du catalogue ;
- `--smoke <chemin.png>` : ouvre le seul panneau, capture son contenu et quitte ;
- `--diagnostics` : ouvre explicitement le panneau technique ;
- sans argument : démarre le connecteur sans fenêtre, accessible dans la barre des menus.

Le schéma `theme.schema.json` décrit la fixture. `Theme.decode` contrôle aussi les
identités uniques et la taille maximale de 32 KiB. Les propriétés inconnues sont
ignorées, jamais exécutées. Le manifeste est copié au build, pas édité en deux endroits.
Le slot `top_left` prépare D1 : ce PoC ne dessine pas encore l'étagère sur le bureau.

## Installation et qualification manuelles

1. Quitter l'app connecteur, puis exécuter `bash pocs/macos-connector/install.sh`
   suivi du chemin exact du `.app` construit. L'installation vise
   `~/Applications/Wallpaper Themes/Wallpaper Connector PoC 2.app` ; une version
   précédente est déplacée dans `dist/pocs/macos-connector/replaced.*/previous-app.disabled`,
   jamais supprimée. Le script refuse les compagnons et providers encore actifs
   et vérifie signature et catalogue avant remplacement. Un provider chargé doit
   être retiré après sélection explicite d'un autre fond, pas en arrêtant Finder.
2. Ouvrir cette app. Si le provider n'apparaît pas dans les Réglages Fond d'écran,
   enregistrer **son chemin exact** avec `pluginkit -a` sur
   `Contents/Extensions/WallpaperProvider.appex`, puis rouvrir les Réglages.
   Cet enregistrement utilise une interface expérimentale et peut être refusé.
3. Choisir un thème dans « Wallpaper Connector — PoC 2 » (groupe parfois tout en bas).
   Orbite : quatre objets sur ellipse ; Lagon : cinq objets sur une trajectoire en
   huit ; Ambre statique : trois objets immobiles, aucune animation créée.
   Chaque choix possède son manifeste et sa vignette. Observer les
   objets colorés. L'extension est alors hébergée par macOS, pas par l'app.
4. Dans l'app, sélectionner **le même thème à contrôler**, « Vérifier la connexion », puis Suspendre/Reprendre et
   Accentuer/Atténuer. Vérifier visuellement l'effet et la quittance corrélée.
   Le sélecteur de l'app ne remplace pas le wallpaper : ce rôle reste aux Réglages.
   Suspendre est indisponible sur Ambre, qui n'a aucune animation.
5. Fermer l'app : le wallpaper doit continuer. Revenir : un seul panneau doit exister.
6. Tester Spaces, Mission Control, verrouillage et veille/reprise. Le provider
   conserve une surface invalidée 15 secondes avant libération pour permettre
   une réacquisition ; cette politique ne garantit pas encore l'absence de flash.
7. Superposer une icône Finder à un objet : aucun clic de thème ne doit partir,
   puisque l'entrée du wallpaper est volontairement passive.

Ne pas lancer plusieurs versions en même temps. Le préflight de l'app refuse les
anciens compagnons/providers et les providers issus d'un autre paquet. Les binaires
historiques déjà installés n'acquièrent pas rétroactivement cette protection : leur
retrait reste nécessaire. Aucun test ne nécessite d'arrêter WallpaperAgent ou Finder.

Pour revenir : sélectionner un autre wallpaper dans les Réglages puis quitter
l'app. Pour désenregistrer, utiliser `pluginkit -r` sur le chemin exact de l'extension.
Le retrait de l'app et du groupe partagé reste une suppression manuelle à confirmer.

## Capacités de cette tranche

Animation et accent visuel sont les seules actions de thème. Audio : absent, donc
pas de fausse commande muet. Interaction bureau : désactivée, sans permission TCC
demandée. Fichiers Finder : lien vers le réglage natif, **pas de toggle automatique**.
Les actions système universelles, UI stylée, import 3D et rig restent dans D1.

Le canal App Group contient seulement `command.json` et `status.json` (16 KiB max),
ce dernier contient une enveloppe `schema_version: 1, themes: [...]`. Un état de
l'ancienne tranche monothème est ignoré, jamais pris pour un état confirmé.
permissions locales restreintes. Une commande comporte instance, génération, UUID
et expiration à cinq secondes. Dédoublonnage des 32 dernières commandes. Le signal
Darwin ne contient aucune commande. Les fichiers ne constituent pas une frontière
contre un processus malveillant du même utilisateur ; aucune exécution shell, URL
arbitraire ou lecture d'asset fournie par un message n'est permise.

Le macOS hôte a journalisé un refus de groupe protégé lié à la signature ad hoc.
Un chemin retourné par `containerURL` dans l'app ne prouve pas l'accès sandbox de
l'extension. Le wallpaper peut être proposé même si ce transport est indisponible ;
le fonctionnement des boutons exige une quittance réelle et reste distinct de
l'affichage du catalogue. Aucun contournement TCC ni droit supplémentaire n'est appliqué.

## Réutilisation et preuves

Les déclarations/shims et la configuration des interfaces privées dérivent de
[Phosphene](https://github.com/kageroumado/Phosphene), révision
`8b5bd57c1450eda74cf2ec6ceaae2e586cfdfcd6`. Licence dans `Native/Bridge/LICENSE`.
Les helpers d'ABI privés restent fragiles ; les tests du modèle ne les qualifient pas.

Voir [la matrice M2](../../docs/pocs/macos-connector-poc2.md) et
[ADR-0052](../../docs/decisions/ADR-0052-macos-poc2-implementation.md).
