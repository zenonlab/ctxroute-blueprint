# Connecteur macOS — PoC 2

Une app AppKit de contrôle, une extension wallpaper native, un catalogue original.
Pas de fenêtre de décor superposée, de terminal, de ROM, de WebView, de hook souris
ou de manipulation automatique des réglages Finder. Le PoC1 reste intact.

## Statut et limites

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
| `Sources/ConnectorTransport` | fichiers JSON atomiques bornés et notifications de réveil |
| `App` | une fenêtre de contrôle et états indisponible/en attente/confirmé |
| `Native` | catalogue Apple, surfaces, cycle de vie, validation du client XPC |
| `Native/Bridge` | déclarations et shims Phosphene, licence MIT conservée |
| `Packaging` | identités et droits des deux bundles |
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
- sans argument : ouvre le connecteur.

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
