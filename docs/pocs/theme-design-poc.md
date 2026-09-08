# D1 — preuve de personnalisation et d'import

État au 8 septembre 2026 : **spécifiée, non implémentée**.
Cette preuve commence après la stabilisation de M2-01 du
[PoC connecteur macOS](macos-connector-poc2.md). Elle évalue le thème, pas l'ancrage OS.

## Question

Peut-on produire une composition cohérente mêlant objet 3D riggé, animation, menu
stylisé et interactions, tout en conservant une recette partageable séparée des assets
privés et un runtime économe ?

## Fixture

La fixture est entièrement originale et contient :

- un véhicule ou personnage low-poly avec squelette et deux clips ;
- un matériau, une texture, une icône et une police de test redistribuables ;
- une piste ou scène simple avec quatre slots d'instances ;
- un panneau de sessions avec bouton, liste, focus clavier et états d'activité ;
- une animation déclenchée par le panneau et un événement de fin renvoyé à l'UI ;
- un fallback 2D pour la ressource 3D absente.

Aucun asset commercial n'est nécessaire pour réussir D1.

## Variantes comparées

1. chargement de la fixture originale depuis le package partageable ;
2. résolution des mêmes slots vers une bibliothèque privée factice ;
3. ressource ou rig incompatible avec diagnostic et fallback ;
4. thème statique, animation active et panneau fermé pour mesurer l'invalidation.

## Critères

| ID | Résultat requis |
| --- | --- |
| D1-01 | hiérarchie, bind pose, poids et deux clips conservés après import |
| D1-02 | quatre instances partagent la ressource sans partager leur état |
| D1-03 | menu visuellement stylé, mais actionnable au clavier et avec focus visible |
| D1-04 | bouton → animation → événement final → état UI sans polling par frame |
| D1-05 | rig incompatible refusé ou retargeté avec rapport explicite |
| D1-06 | export de recette sans asset privé, chemin absolu ou contenu de session |
| D1-07 | remplacement du renderer sans modifier la recette ou les identités |
| D1-08 | scène statique sans timer ; systèmes invisibles suspendus |
| D1-09 | décompte mémoire, frames et énergie incrémentale documenté |
| D1-10 | rendu et menu forment une composition unique, sans panneau diagnostic du connecteur |

## Hors périmètre

Pas d'éditeur grand public complet, marketplace, génération IA en runtime, conversion
de ROM réelle, terminal PTY, physique de jeu complète ou certification multi-OS.

## Sortie

D1 choisit le contrat minimal de thème et fournit une scène représentative pour
comparer les backends de rendu. Il ne choisit pas à lui seul la stack du terminal ou
le mécanisme wallpaper de chaque OS.
