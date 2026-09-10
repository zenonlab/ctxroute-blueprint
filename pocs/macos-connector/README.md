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

Le build refuse `CONNECTOR_LOCAL_BACKGROUND_PATH` : les ressources privées restent dans le package externe.

## Package de thème

Le descripteur public `orbite-theme.json` utilise `orbite.theme-package/1` :

```json
{
  "format": "orbite.theme-package/1",
  "id": "example.course",
  "display_name": "Course locale",
  "entry": { "format": "orbite.scene-probe/1", "path": "scene.json" },
  "renderer": "bevy-0.19"
}
```

Les chemins restent relatifs au package. Les liens symboliques, traversées, fichiers trop gros, formats incohérents et identités dupliquées sont refusés.

## Packaging et migration

Le paquet produit contient l’app, son agent embarqué et une seule `WallpaperProvider.appex`. Il ne contient aucun `catalog.json`, `theme*.json` ou asset de thème. L’extension génère seulement une vignette Orbite neutre dans son conteneur temporaire.

Lors d’une mise à jour, `install.sh` arrête uniquement le job Orbite attendu, désenregistre l’ancienne extension `org.orbite.wallpaper.provider` si son chemin appartient à Orbite, et conserve l’ancienne app sous `dist/pocs/macos-connector/replaced.*`.

Voir [ADR-0074](../../docs/decisions/ADR-0074-external-themes-only.md), [ADR-0075](../../docs/decisions/ADR-0075-external-catalog-wallpaper-provider.md) et le [diagramme du runtime](../../docs/architecture/src/macos-external-theme-runtime.dataflow.json).
