# Connecteur macOS Swift

Le connecteur est une app AppKit, un agent de session et une extension Wallpaper expérimentale. Il ne contient aucun thème, catalogue statique ou asset de démonstration.

## Flux courant

1. L’utilisateur ajoute un dossier de bibliothèque.
2. `ThemeDiscovery` recherche les `orbite-theme.json` et valide chaque package de façon bornée.
3. L’app et Réglages Système > Fond d’écran affichent uniquement les packages acceptés.
4. L’utilisateur associe leur capacité `renderer` à un RenderHost exécutable local.
5. Un clic dans l’app ou sur la tuile de Réglages transmet une intention typée à l’agent.
6. L’agent lance directement le RenderHost avec la recette validée et `--desktop`, sans commande de manifeste et sans shell.

Les racines viennent des préférences, de `Application Support/Orbite/Themes` si ce dossier existe, ou de `ORBITE_THEME_PATHS` pour un diagnostic explicite. Aucun chemin de dépôt, nom de jeu ou liste de thèmes n’est codé dans Swift.

## Commandes

```sh
swift test --package-path pocs/macos-connector
bash pocs/macos-connector/build.sh
bash pocs/macos-connector/build.sh --sign CERTIFICATE_SHA1
bash pocs/macos-connector/install.sh "/chemin/vers/Orbite Wallpaper.app"
bash pocs/macos-connector/start-agent.sh "$HOME/Applications/Wallpaper Themes/Orbite Wallpaper.app" --persistent --diagnostics
```

Découverte sans UI :

```sh
"/chemin/vers/Orbite Wallpaper.app/Contents/MacOS/WallpaperConnector" \
  --discover-themes "/chemin/vers/une/bibliothèque"
```

Catalogue réellement publié par l’agent installé :

```sh
"/chemin/vers/Orbite Wallpaper.app/Contents/MacOS/WallpaperConnector" --provider-catalog
```

Diagnostic d’activation typé, sans shell ni commande fournie par le manifeste :

```sh
"/chemin/vers/Orbite Wallpaper.app/Contents/MacOS/WallpaperConnector" --activate-theme example.course
```

Le build refuse `CONNECTOR_LOCAL_BACKGROUND_PATH` : les ressources privées restent dans le package externe.

## Package de thème

Le descripteur public `orbite-theme.json` utilise `orbite.theme-package/1` :

```json
{
  "format": "orbite.theme-package/1",
  "id": "example.course",
  "display_name": "Course locale",
  "entry": { "format": "orbite.scene-probe/1", "path": "scene.json" },
  "renderer": "bevy-0.19",
  "thumbnail": "cover.png"
}
```

`thumbnail` est optionnel et pointe vers une cover PNG privée. L’agent transmet uniquement son URL locale validée et le provider la déclare à macOS comme fichier du choix ; il utilise le fallback Orbite seulement si le package n’en fournit pas. Les chemins restent relatifs au package. Les liens symboliques, traversées, fichiers trop gros, formats incohérents et identités dupliquées sont refusés.

## Packaging et migration

Le paquet produit contient l’app, son agent embarqué et une seule `WallpaperProvider.appex`. Il ne contient aucun `catalog.json`, `theme*.json` ou asset de thème. Les covers restent dans les packages externes et sont copiées uniquement dans le cache temporaire du provider.

Le provider relit le catalogue pendant que Réglages est connecté et pousse les modèles modifiés au panneau sous trois secondes, sans tuer Réglages ni WallpaperAgent. Lors d’une mise à jour binaire, `install.sh` décharge aussi l’ancien job de test Orbite `org.orbite.wallpaper.renderhost-test`, arrête les RenderHosts enfants de son propre agent avant cet agent, puis arrête l’ancien processus dont le chemin est exactement celui du provider Orbite. Il désenregistre ensuite l’ancienne extension et conserve l’ancienne app sous `dist/pocs/macos-connector/replaced.*`.

## Menu de personnalisation automatique

Un package peut référencer une interface `orbite.theme-interface/5`. Ses étapes
déclarent l'ordre, le libellé, la catégorie opaque, le nombre de colonnes et les
compatibilités. Le connecteur crée toutes les sections à partir de ces données ;
ajouter une catégorie ne demande aucune branche Swift. Les choix persistés utilisent
`selections`, tandis que les anciens overrides personnage/véhicule sont migrés à la
lecture. Le [schéma v5 et son exemple neutre](../../docs/templates/theme-interface-v5.schema.json)
constituent le template de création.

Voir [ADR-0074](../../docs/decisions/ADR-0074-external-themes-only.md), [ADR-0075](../../docs/decisions/ADR-0075-external-catalog-wallpaper-provider.md) et le [diagramme du runtime](../../docs/architecture/src/macos-external-theme-runtime.dataflow.json).
