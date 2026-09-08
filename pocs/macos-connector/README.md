# Connecteur macOS — PoC 2

Une app AppKit de contrôle, une extension wallpaper native, un manifeste original.
Pas de fenêtre de décor superposée, de terminal, de ROM, de WebView, de hook souris
ou de manipulation automatique des réglages Finder. Le PoC1 reste intact.

## Statut et limites

Le code compile avec Swift 6 strict ; les quatre tests XCTest passent. Les deux
bundles sont signés ad hoc et leur manifeste embarqué est identique. Ce résultat
n'est **pas** une qualification du wallpaper dans WallpaperAgent : activation,
Spaces, animation visible, commandes interprocessus et énergie restent à vérifier
sur la session graphique. L'app ne confirme une action qu'après réception d'une
quittance du provider ; un fichier d'état ancien ne prouve pas sa présence.

Build testé le 8 septembre : `dist/pocs/macos-connector/build.IEzf9z/Wallpaper Connector PoC 2.app`.
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

Le provider possède l'état en mémoire pour toutes ses surfaces. L'app envoie des
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

Le build affiche le chemin du nouveau `.app` dans `dist/pocs/macos-connector/build.*`.
Il ne remplace aucun build, n'installe rien et ne change pas le wallpaper actif.
Il utilise uniquement le SDK Apple et les fichiers versionnés ; aucun téléchargement.

L'exécutable `Contents/MacOS/WallpaperConnector` accepte :

- `--check` : valide le manifeste et l'accès au répertoire App Group ;
- `--thumbnail <chemin.png>` : exporte la fixture, sans animer ni ouvrir une fenêtre ;
- `--smoke <chemin.png>` : ouvre le seul panneau, capture son contenu et quitte ;
- sans argument : ouvre le connecteur.

Le schéma `theme.schema.json` décrit la fixture. `Theme.decode` contrôle aussi les
identités uniques et la taille maximale de 32 KiB. Les propriétés inconnues sont
ignorées, jamais exécutées. Le manifeste est copié au build, pas édité en deux endroits.
Le slot `top_left` prépare D1 : ce PoC ne dessine pas encore l'étagère sur le bureau.

## Installation et qualification manuelles

1. Copier le `.app` construit dans un emplacement utilisateur stable (Applications).
   Ne pas écraser une ancienne installation ; la conserver avant remplacement.
2. Ouvrir cette app. Si le provider n'apparaît pas dans les Réglages Fond d'écran,
   enregistrer **son chemin exact** avec `pluginkit -a` sur
   `Contents/Extensions/WallpaperProvider.appex`, puis rouvrir les Réglages.
   Cet enregistrement utilise une interface expérimentale et peut être refusé.
3. Choisir « Orbite » dans « Wallpaper Connector — PoC2 ». Observer les quatre
   objets colorés. L'extension est alors hébergée par macOS, pas par l'app.
4. Dans l'app, « Vérifier la connexion », puis Suspendre/Reprendre et
   Accentuer/Atténuer. Vérifier visuellement l'effet et la quittance corrélée.
5. Fermer l'app : le wallpaper doit continuer. Revenir : un seul panneau doit exister.
6. Tester Spaces, Mission Control, verrouillage et veille/reprise. Le provider
   conserve une surface invalidée 15 secondes avant libération pour permettre
   une réacquisition ; cette politique ne garantit pas encore l'absence de flash.
7. Superposer une icône Finder à un objet : aucun clic de thème ne doit partir,
   puisque l'entrée du wallpaper est volontairement passive.

Ne pas lancer plusieurs versions de cette nouvelle identité en même temps. Aucun
test ne nécessite d'arrêter WallpaperAgent, Finder ou l'ancien PoC.

Pour revenir : sélectionner un autre wallpaper dans les Réglages puis quitter
l'app. Pour désenregistrer, utiliser `pluginkit -r` sur le chemin exact de l'extension.
Le retrait de l'app et du groupe partagé reste une suppression manuelle à confirmer.

## Capacités de cette tranche

Animation et accent visuel sont les seules actions de thème. Audio : absent, donc
pas de fausse commande muet. Interaction bureau : désactivée, sans permission TCC
demandée. Fichiers Finder : lien vers le réglage natif, **pas de toggle automatique**.
Les actions système universelles, UI stylée, import 3D et rig restent dans D1.

Le canal App Group contient seulement `command.json` et `status.json` (16 KiB max),
permissions locales restreintes. Une commande comporte instance, génération, UUID
et expiration à cinq secondes. Dédoublonnage des 32 dernières commandes. Le signal
Darwin ne contient aucune commande. Les fichiers ne constituent pas une frontière
contre un processus malveillant du même utilisateur ; aucune exécution shell, URL
arbitraire ou lecture d'asset fournie par un message n'est permise.

## Réutilisation et preuves

Les déclarations/shims et la configuration des interfaces privées dérivent de
[Phosphene](https://github.com/kageroumado/Phosphene), révision
`8b5bd57c1450eda74cf2ec6ceaae2e586cfdfcd6`. Licence dans `Native/Bridge/LICENSE`.
Les helpers d'ABI privés restent fragiles ; les tests du modèle ne les qualifient pas.

Voir [la matrice M2](../../docs/pocs/macos-connector-poc2.md) et
[ADR-0052](../../docs/decisions/ADR-0052-macos-poc2-implementation.md).
