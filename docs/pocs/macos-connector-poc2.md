# PoC 2 — connecteur macOS Swift

État au 10 septembre 2026 : **catalogue externe raccordé à Réglages Fond d’écran ; aucun thème natif embarqué ; qualification visuelle utilisateur requise**.

## But

Qualifier un connecteur Swift qui découvre des thèmes locaux et confie leur rendu desktop à un RenderHost approuvé, sans contenu de thème dans l’application.

## Livrable borné

Une app AppKit signée, son agent de session, une extension Wallpaper expérimentale, le scanner de packages, le registre local de capacités et le contrôle d’un unique RenderHost enfant.

## Stack expérimentale

Swift 6, AppKit, launchd utilisateur et contrats JSON portables. Le renderer courant reste Bevy 0.19.1 derrière le contrat RenderHost ; il n’est pas lié au binaire Swift.

## Résultat courant

Le paquet macOS contient une app AppKit, un agent de session et une extension Wallpaper expérimentale. L’extension ne possède aucun catalogue natif : elle expose dans Réglages Système le résultat courant de `ThemeDiscovery` fourni par l’agent signé.

Le connecteur découvre automatiquement les packages présents dans les bibliothèques choisies par l’utilisateur. Un thème valide fournit son identité, son libellé, sa recette relative et une capacité de renderer. Le chemin du RenderHost est une approbation locale distincte ; le manifeste ne peut fournir ni commande ni chemin d’exécutable.

Le RenderHost est lancé directement avec le chemin de la recette validée,
`--desktop` et, lorsqu'il existe, le manifeste d'interface privé validé. Le
contrôleur possède un seul processus enfant et l'arrête lors d'un changement de
thème, d'une demande explicite ou de l'arrêt de l'agent. Il transmet les réglages et
overrides par JSON borné sur stdin et reçoit les cibles de hit-test par JSON borné
sur stdout.

## Contrats

- `orbite.theme-package/1` décrit le package externe.
- `orbite.scene-probe/1` et `orbite.theme-package/2` sont les formats d’entrée actuellement acceptés.
- `renderer` est un identifiant de capacité, jamais une commande.
- Les packages et assets privés restent hors de l’app et hors Git.
- Le sélecteur Swift est alimenté uniquement par `ThemeDiscovery`.
- Les fichiers du bureau restent un réglage Finder réversible ; aucune suppression n'est effectuée.
- `orbite.theme-interface/1` fournit les images privées, choix d'apparence, cibles
  et sessions sans introduire de nom de jeu dans Swift.

## Sécurité et limites

La découverte borne le nombre de racines et de manifestes, leur taille, les formats et les identités. Elle refuse les liens symboliques, les traversées de répertoire et les entrées incohérentes.

Le registre de RenderHost accepte uniquement un fichier ordinaire local et exécutable choisi par l’utilisateur. Aucun shell n’est invoqué.

Le positionnement sous les icônes Finder est implémenté dans le RenderHost macOS. Sa stabilité sur Spaces, multi-écran, veille et reprise doit encore être qualifiée sur la machine cible. Le provider de Réglages repose sur `WallpaperExtensionKit`, une API privée de macOS 26 : il reste expérimental et hors Mac App Store.

## Règle du panneau unique

Le connecteur possède une seule fenêtre native de sélection, permission et récupération. Toute UI visuelle propre au thème appartient au RenderHost et à la recette externe.

## Critères d'acceptation

- Aucun `theme*.json`, `catalog.json` ou asset de thème dans le paquet produit.
- L’extension Wallpaper contient seulement le pont natif, le fallback Orbite généré et l’exigence de signature de l’agent ; une cover éventuelle vient du package externe.
- Une bibliothèque vide affiche zéro thème, sans fallback implicite.
- Ajouter un package compatible le fait apparaître sans changement Swift.
- Modifier le catalogue ou sa cover actualise Réglages sans redémarrer les processus Apple.
- Une recette invalide est refusée et ne lance aucun processus.
- Une capacité sans RenderHost approuvé échoue explicitement.
- Le manifeste ne peut choisir ni exécutable ni commande shell.
- Une nouvelle activation remplace seulement le RenderHost enfant possédé.
- Le masquage des fichiers Finder reste réversible.
- Audio, fichiers et luminosité utilisent seulement les images du package privé.
- Les choix personnage/véhicule sont une galerie illustrée par ce même package,
  avec une image de menu source distincte du matériau appliqué dans la scène.
- Un clic droit qualifié sur un kart ouvre le customiseur prérempli ; gauche focalise
  sa session simulée sans double action.
- Le customiseur affiche l'état et la séquence de la session choisie ; `Focaliser` et
  `Ouvrir` émettent des intentions typées vers le simulateur, sans PTY ni texte terminal.
- Sauvegarde, annulation et reset ne changent ni l'identité, ni le trajet, ni la
  session hors du champ explicitement sélectionné.
- SwiftPM, compilation Swift stricte, signature, invariant de paquet et `npm run verify` passent.

## Conditions de sortie

Le PoC sort de cette tranche lorsqu’un package privé est détecté sans modification Swift, lancé avec son RenderHost approuvé, visible sous Finder, puis arrêté sans processus orphelin. Spaces, multi-écran et reprise restent des qualifications manuelles explicites.

## Ordre d'implémentation

1. Valider le contrat et la découverte externe.
2. Résoudre le RenderHost par capacité locale.
3. Construire et signer l’app, son agent et le provider sans ressources de thème.
4. Enregistrer un unique provider canonique lors de l’installation.
5. Qualifier visuellement l’ancrage desktop et le cycle de vie.

## Vérification

```sh
swift test --package-path pocs/macos-connector
bash pocs/macos-connector/build.sh
```

Le build vérifie la présence et la signature de l’unique extension, l’absence de `theme*.json` et de `catalog.json`, puis exécute `--check` sur le paquet final.

Les décisions sont consignées dans [ADR-0072](../decisions/ADR-0072-automatic-local-theme-discovery.md), [ADR-0073](../decisions/ADR-0073-capability-based-renderhost.md), [ADR-0074](../decisions/ADR-0074-external-themes-only.md) et [ADR-0075](../decisions/ADR-0075-external-catalog-wallpaper-provider.md).
