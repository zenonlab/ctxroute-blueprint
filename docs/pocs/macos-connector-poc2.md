# PoC 2 — connecteur macOS Swift

État au 10 septembre 2026 : **runtime externe raccordé ; aucun thème natif embarqué ; qualification visuelle utilisateur requise**.

## But

Qualifier un connecteur Swift qui découvre des thèmes locaux et confie leur rendu desktop à un RenderHost approuvé, sans contenu de thème dans l’application.

## Livrable borné

Une app AppKit signée, son agent de session, le scanner de packages, le registre local de capacités et le contrôle d’un unique RenderHost enfant.

## Stack expérimentale

Swift 6, AppKit, launchd utilisateur et contrats JSON portables. Le renderer courant reste Bevy 0.19.1 derrière le contrat RenderHost ; il n’est pas lié au binaire Swift.

## Résultat courant

Le paquet macOS contient une app AppKit et un agent de session. Le catalogue de trois fixtures et l’extension Apple expérimentale ont été retirés. Ils ne sont plus construits, signés, installés ou proposés dans l’interface.

Le connecteur découvre automatiquement les packages présents dans les bibliothèques choisies par l’utilisateur. Un thème valide fournit son identité, son libellé, sa recette relative et une capacité de renderer. Le chemin du RenderHost est une approbation locale distincte ; le manifeste ne peut fournir ni commande ni chemin d’exécutable.

Le RenderHost est lancé directement avec deux arguments bornés : le chemin de la recette validée et `--desktop`. Le contrôleur possède un seul processus enfant et l’arrête lors d’un changement de thème, d’une demande explicite ou de l’arrêt de l’agent.

## Contrats

- `orbite.theme-package/1` décrit le package externe.
- `orbite.scene-probe/1` et `orbite.theme-package/2` sont les formats d’entrée actuellement acceptés.
- `renderer` est un identifiant de capacité, jamais une commande.
- Les packages et assets privés restent hors de l’app et hors Git.
- Le sélecteur Swift est alimenté uniquement par `ThemeDiscovery`.
- Les fichiers du bureau restent un réglage Finder réversible ; aucune suppression n’est effectuée.

## Sécurité et limites

La découverte borne le nombre de racines et de manifestes, leur taille, les formats et les identités. Elle refuse les liens symboliques, les traversées de répertoire et les entrées incohérentes.

Le registre de RenderHost accepte uniquement un fichier ordinaire local et exécutable choisi par l’utilisateur. Aucun shell n’est invoqué.

Le positionnement sous les icônes Finder est implémenté dans le RenderHost macOS. Sa stabilité sur Spaces, multi-écran, veille et reprise doit encore être qualifiée sur la machine cible. Le PoC ne prétend plus utiliser le provider des Réglages Wallpaper d’Apple.

## Règle du panneau unique

Le connecteur possède une seule fenêtre native de sélection, permission et récupération. Toute UI visuelle propre au thème appartient au RenderHost et à la recette externe.

## Critères d'acceptation

- Aucun `theme*.json`, `catalog.json`, asset de thème ou extension wallpaper dans le paquet produit.
- Une bibliothèque vide affiche zéro thème, sans fallback implicite.
- Ajouter un package compatible le fait apparaître sans changement Swift.
- Une recette invalide est refusée et ne lance aucun processus.
- Une capacité sans RenderHost approuvé échoue explicitement.
- Le manifeste ne peut choisir ni exécutable ni commande shell.
- Une nouvelle activation remplace seulement le RenderHost enfant possédé.
- Le masquage des fichiers Finder reste réversible.
- SwiftPM, compilation Swift stricte, signature, invariant de paquet et `npm run verify` passent.

## Conditions de sortie

Le PoC sort de cette tranche lorsqu’un package privé est détecté sans modification Swift, lancé avec son RenderHost approuvé, visible sous Finder, puis arrêté sans processus orphelin. Spaces, multi-écran et reprise restent des qualifications manuelles explicites.

## Ordre d'implémentation

1. Valider le contrat et la découverte externe.
2. Résoudre le RenderHost par capacité locale.
3. Construire et signer l’app et son agent sans ressources de thème.
4. Migrer l’installation et retirer l’ancien provider.
5. Qualifier visuellement l’ancrage desktop et le cycle de vie.

## Vérification

```sh
swift test --package-path pocs/macos-connector
bash pocs/macos-connector/build.sh
```

Le build vérifie l’absence de `Contents/Extensions`, de `theme*.json` et de `catalog.json`, puis exécute `--check` sur le paquet final.

Les décisions sont consignées dans [ADR-0072](../decisions/ADR-0072-automatic-local-theme-discovery.md), [ADR-0073](../decisions/ADR-0073-capability-based-renderhost.md) et [ADR-0074](../decisions/ADR-0074-external-themes-only.md).
