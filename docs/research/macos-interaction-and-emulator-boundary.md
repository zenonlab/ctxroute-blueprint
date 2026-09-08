# Interaction macOS et frontière d’observation par émulateur

## Verdict

Le wallpaper natif et l’entrée interactive sont deux plans différents.
`WallpaperExtensionKit` fournit les pixels au processus système
`WallpaperAgent`, mais ne fournit pas de canal documenté pour recevoir les clics.
Une fenêtre transparente ajoutée par l’application n’est pas une extension de ce
wallpaper : elle participe au Z-order AppKit ordinaire et peut passer devant les
applications. Le PoC2 a reproduit cette erreur avec deux micro-fenêtres au niveau
`normal - 1`. Un relevé WindowServer les a observées devant des fenêtres Chrome
de niveau 0. Cette architecture est rejetée.

Le PoC corrigé conserve un seul plan visuel, celui du provider, et un seul plan
d’entrée, un `CGEventTap` actif appartenant à l’agent local. Les contrôles fixes,
les objets animés et le clic droit sur l’espace vide utilisent le même calcul de
géométrie et le même cycle appui-déplacement-relâchement. Un événement n’est
supprimé que si l’agent possède une surface publiée, une cible du thème connue et
une qualification positive du fond Finder. Tout état inconnu reste géré par macOS.

L’émulateur suit la même règle de séparation. Il peut être un instrument local,
optionnel et hors ligne pour produire des observations déterministes lorsque
l’analyse statique ne suffit pas. Il ne devient ni le renderer du wallpaper, ni
une dépendance d’un package de thème, ni une source universelle de comportements
sémantiques. Les résultats utiles sont transformés, qualifiés et reliés dans la
bibliothèque privée du jeu ; le runtime ne charge que la sélection préparée.

## Ce que prouve le pipeline Apple

Phosphene constitue la référence publique la plus proche du provider utilisé par
le PoC. Son extension charge le framework privé `WallpaperExtensionKit`, répond
aux requêtes XPC de `WallpaperAgent` et rend dans un `CAContext` distant. L’app de
barre de menus reste responsable de la bibliothèque et des commandes.^1 Cette
architecture prouve qu’un vrai wallpaper peut survivre à la fermeture de l’app et
suivre le cycle verrouillage/veille. Elle ne montre aucun protocole d’entrée dans
l’extension ; les contrôles de Phosphene restent hors du wallpaper.

Le framework est privé. Les types de requêtes ne figurent pas dans le SDK public
et Phosphene les interprète par réflexion. Une mise à jour majeure de macOS peut
donc casser chirurgicalement le provider même si l’agent et les contrats du thème
restent valides.^1 La frontière `SurfaceProvider` doit rester remplaçable et ne
jamais contaminer le format de thème avec les types privés Apple.

AppKit ordonne les fenêtres par niveau puis par ordre au sein d’un niveau.
`orderFrontRegardless` amène une fenêtre à l’avant de son niveau, même lorsque
l’application est inactive.^2 Le niveau calculé `normal - 1` n’a pas créé le plan
« entre le fond Finder et les icônes » supposé : sur la machine MAC-01, les panels
ont été publiés au niveau Core Graphics 0 et devant Chrome. La documentation Apple
expose des clés pour le bureau et les icônes, mais ne fournit pas de contrat public
garantissant une fenêtre tierce interactive entre les deux sous-couches privées de
Finder.^3

`ignoresMouseEvents` s’applique à la fenêtre entière.^4 Il convient pour une
surface décorative, pas pour des zones interactives arbitraires. Un `hitTest:` de
vue ne résout pas le cas où la fenêtre se trouve sous Finder, et une fenêtre placée
au-dessus afin de recevoir l’événement viole la priorité des applications. Le PoC
ne doit donc plus utiliser de fenêtre comme proxy d’entrée.

## Écoute et interception ne sont pas équivalentes

Core Graphics distingue les taps passifs et actifs. Un tap passif observe puis
laisse poursuivre l’événement. Un tap actif peut retourner `nil` et supprimer cet
événement du flux, sous réserve des autorisations nécessaires.^5

Mineradio illustre le premier modèle. Son code crée un tap de session
`listenOnly`, détermine si le point paraît appartenir au bureau et transmet une
copie au renderer Electron avec `sendInputEvent`. Son callback retourne toujours
l’événement original.^6 Ce montage peut produire une réaction visuelle dans le
renderer, mais il ne garantit pas l’absence de l’action Finder concomitante. Il
utilise en outre une constante de niveau Finder mesurée et interroge la liste des
fenêtres dans le callback. Il constitue une preuve de faisabilité pour le survol
et la duplication d’entrée, pas pour l’exclusivité exigée ici.

Halo illustre le second modèle. Son tap `.defaultTap` fonctionne sur un thread
dédié, retourne `nil` lorsque le raccourci doit être avalé et réarme le port si le
système le désactive.^7 Son domaine fonctionnel est différent — clavier et overlay
temporaire — mais son cycle de vie est la bonne référence pour une interception
exclusive. Halo souligne aussi qu’une identité de signature stable est nécessaire
pour conserver l’autorisation Accessibility entre deux builds.^7

La méthode retenue combine ces enseignements sans importer leur UI :

| Responsabilité | Implémentation PoC2 | Comportement de sûreté |
| --- | --- | --- |
| Pixels | Provider dans `WallpaperAgent` | Aucun panneau visuel de l’agent sur le bureau |
| Catalogue actif | Statut XPC borné et signé | Pas de surface confirmée, pas de cible interactive |
| Géométrie | Instantané immuable des surfaces et thèmes | Ambiguïté entre deux représentations : refus |
| Priorité Finder | Hit-test AX du point et chaîne de rôles bornée | Icône, texte, bouton, fenêtre ou erreur : macOS garde le clic |
| Geste | Routeur appui/drag/relâchement | Un drag ne devient jamais un clic ; le relâchement capturé reste équilibré |
| Interception | `CGEventTap` actif annoté, CFRunLoop dédié | `nil` uniquement pour un geste positivement capturé |
| Action | Dispatch asynchrone vers l’acteur principal | Aucun XPC, ouverture d’app ou modale dans le callback |
| Reprise | Réarmement sur notifications de désactivation | État publié dans le diagnostic ; aucun succès silencieux |

Le callback effectue encore une qualification AX bornée lors des appuis et des
relâchements. C’est acceptable pour le PoC de faisabilité, pas encore une preuve
de coût de production. L’étape suivante doit comparer ce chemin à un cache de
qualification maintenu hors callback. Un cache ne peut être adopté que s’il garde
la priorité d’une icône déplacée juste avant le clic et échoue ouvert lorsque son
âge ou sa provenance ne sont plus valides.

## État observé du PoC corrigé

Sur MAC-01, macOS 26.2, le 9 septembre 2026 :

- le paquet est signé avec l’exigence désignée stable
  `identifier org.wallpaperthemes.connectorpoc2.agent` et le certificat local
  `8F422B938988AFF3A82FD871B42A66CAE13F865F` ;
- l’ancien paquet a été déplacé dans un dossier de remplacement récupérable avant
  installation ;
- Orbite est sélectionné dans Réglages Système ;
- le provider installé publie deux surfaces et répond aux commandes XPC ;
- le diagnostic de l’agent affiche `Accessibilité accordée · tap actif` ;
- les tests compilés prouvent la projection de géométrie sans création de fenêtre,
  les invariants de geste, la politique Finder pure et le cycle de récupération
  injecté.

Ces preuves ne remplacent pas le test manuel d’un vrai clic. La validation B-O
reste ouverte jusqu’à exécution répétée des cas suivants sur le paquet exact :

1. bouton Audio : une seule révision de thème et aucun geste « afficher le bureau » ;
2. bouton Fichiers : une seule mutation, état relu, Finder rafraîchi et voie de
   réaffichage toujours accessible depuis la barre de menus ;
3. clic gauche sur objet : ouverture unique de l’application associée ;
4. clic droit sur objet : une seule modale préremplie ;
5. clic droit vide : modale d’ajout ; clic gauche vide : comportement Finder natif ;
6. icône Finder exactement superposée : ouverture, menu contextuel et drag Finder,
   sans intention du thème ;
7. fenêtre applicative au-dessus : aucune interception ;
8. changement de Space, veille/reprise et redémarrage Finder : tap actif ou état de
   dégradation visible, jamais une panne silencieuse.

## Rôle exact d’un émulateur dans la conversion

Un émulateur offre trois familles de données qui peuvent compléter un lecteur
statique : images/audio produits, état mémoire/registers, et séquence temporelle
d’exécution. Il ne fournit pas automatiquement les concepts « kart », « virage »,
« collision de sol », « bot aligné » ou « session terminal ». Ces concepts doivent
être retrouvés dans des symboles ou données connus, corrélés par observation, ou
créés par la composition du thème.

L’API libretro est utile comme façade d’exécution générique. Un core expose des
callbacks vidéo, audio et entrée, ainsi qu’une sérialisation d’état lorsqu’elle est
supportée.^8 Cela permet un runner déterministe commun à de nombreuses plateformes :
charger un état local, appliquer une séquence d’entrées, capturer N frames et
revenir au même état. L’ABI ne définit cependant ni graphe de scène, ni collision,
ni entité, ni sémantique de gameplay. Une intégration libretro seule ne peut donc
pas produire la bibliothèque canonique.

Dolphin fournit un FIFO Player capable d’enregistrer puis rejouer les commandes
graphiques d’une scène GameCube/Wii et d’isoler des groupes de dessins.^9 C’est une
excellente source pour vérifier la fidélité d’un matériau, identifier des objets
rendus et comprendre une séquence GPU. Le FIFO est une trace de rendu : il ne
restitue pas les règles de course, les collisions CPU, les scripts d’acteurs ou les
relations sémantiques absentes des commandes graphiques.

MAME expose une API Lua plus introspective : appareils, registres, espaces mémoire,
hooks de lecture/écriture, événements de frame et pixels d’écran.^10 Elle convient
aux systèmes couverts par MAME et à des expériences de corrélation mémoire-écran.
La documentation précise que cette API n’est pas déclarée stable.^10 Chaque recette
doit donc épingler la version de MAME et tester ses capacités au démarrage.

DuckStation montre une autre limite utile. Son système de dump de textures suit
les écritures VRAM et les palettes, mais sa propre documentation prévient que les
jeux et méthodes de dump présentent de nombreux cas particuliers.^11 Les hashes
de textures sont utiles pour la déduplication et la corrélation. Ils ne constituent
pas des identifiants d’entités ou de scènes fiables sans adaptateur.

Ghidra peut exécuter l’analyse et des scripts en mode headless, avec import,
pré/post-scripts, traitement en lecture seule et timeout par fichier.^12 Il peut
donc aider un adaptateur à retrouver tables, fonctions et références. Un résultat
de décompilation reste une représentation d’analyse, pas un module de gameplay
prêt à embarquer. Les symboles, signatures et hypothèses doivent être versionnés
et testés contre la révision exacte du jeu.

## Architecture de conversion recommandée

La chaîne hors ligne doit accepter plusieurs observateurs derrière un même contrat
de preuves, sans prétendre qu’ils sont interchangeables :

| Étape | Entrée | Sortie autorisée | Interdit |
| --- | --- | --- | --- |
| Identification | Fichier fourni localement | plateforme, révision, hashes, adaptateurs candidats | envoi de la ROM ou d’extraits à un service distant |
| Analyse statique | support monté en lecture seule | fichiers, tables, symboles, provenance | exécution du code invité dans le runtime wallpaper |
| Observation émulée | core/version épinglés, état et inputs déterministes | trace bornée vidéo/audio/mémoire/GPU | session d’émulation permanente comme fond d’écran |
| Corrélation | traces + données statiques | relations qualifiées avec niveau de confiance | transformer une proximité visuelle en fait certain |
| Matérialisation | ressources et relations prouvées | bibliothèque privée, dérivés par scène | fusion dans le package partageable |
| Composition | recette du thème | sélection d’entités, contrôleurs adaptés, liens terminal | dépendance à la ROM ouverte ou à l’émulateur actif |

Chaque adaptateur publie un manifeste de capacités :

```json
{
  "adapter": "example.game.revision",
  "source": { "kind": "user-local", "content_hash": "..." },
  "observers": [
    { "kind": "static", "tool": "reader", "revision": "..." },
    { "kind": "emulator", "tool": "libretro-core", "revision": "..." }
  ],
  "capabilities": {
    "visual_scene": "verified",
    "collision": "verified",
    "entity_placement": "verified",
    "bot_controller": "adapted",
    "audio_loop": "unknown"
  }
}
```

Les valeurs minimales sont `verified`, `adapted`, `approximated`, `unknown` et
`unsupported`. `verified` exige une preuve reproductible ; `adapted` désigne une
logique conçue pour le thème à partir d’éléments compris ; `approximated` signale
un substitut perceptuel. Cette distinction permet, par exemple, d’utiliser les
splines et collisions originales d’une course tout en remplaçant l’IA complète des
bots par un contrôleur de formation stable piloté par les sessions terminal.

## Application au thème de course

Pour aligner des véhicules représentant des sessions tout en conservant une course
crédible, la composition a besoin de plus qu’une minimap PNG :

- une trajectoire de référence dans le repère du monde ;
- une projection monde-vers-minimap et son inverse éventuel ;
- la géométrie ou les surfaces de collision pertinentes ;
- les poses et animations de chaque véhicule ;
- les règles d’avancement, virage, reprise et espacement ;
- l’association stable entre véhicule et session.

L’adaptateur peut récupérer ces éléments depuis des tables statiques, une
décompilation existante ou une observation instrumentée. S’ils restent absents,
la composition peut créer un contrôleur de formation explicite : paramètre curviligne
sur une spline, distance minimale, rattrapage borné et animation Lakitu lors d’un
agent arrêté. Ce contrôleur est alors `adapted`, non présenté comme l’algorithme
original du jeu. Le runtime n’a pas besoin de simuler les adversaires, objets,
dégâts et règles de victoire qui n’influencent pas le thème.

## Prototypes avant adoption d’un émulateur

Le passage à l’observation émulée commence par un seul slice et deux candidats au
maximum. Il ne commence pas par une matrice de toutes les consoles.

### E6-A — Runner déterministe

- fixture libre ou homebrew distribuable ;
- core libretro épinglé ;
- état sérialisé si supporté ;
- séquence d’inputs et nombre de frames fixés ;
- hashes des frames, de l’audio et des traces comparés sur cinq exécutions ;
- réseau interdit, entrée en lecture seule, sortie dédiée et quotas appliqués.

### E6-B — Observation spécialisée

- une scène GameCube/Wii via FIFO Dolphin, ou un système MAME via Lua ;
- capture d’un objet et d’une variable connue ;
- corrélation reproductible avec une donnée statique ;
- mesure du coût et inventaire exact des informations perdues ;
- aucune donnée commerciale ajoutée au dépôt.

### E6-C — Sortie autonome

- arrêt complet de l’émulateur et du convertisseur ;
- lancement du runtime avec la seule bibliothèque locale préparée ;
- rendu, animation, collision et interactions fonctionnels selon le manifeste ;
- preuve qu’aucun processus d’émulation n’est présent ;
- comparaison énergétique au wallpaper natif selon le protocole B-R.

Un échec d’E6-A interdit de qualifier l’observation de déterministe. Un échec
d’E6-B limite les capacités de l’adaptateur, pas l’ensemble du produit. Un échec
d’E6-C signifie que la frontière hors ligne/runtime n’est pas respectée et bloque
l’adoption de ce chemin.

## Sources

1. Kageroumado, « [Phosphene](https://github.com/kageroumado/phosphene) », architecture et limites de `WallpaperExtensionKit`, consulté le 9 septembre 2026.
2. Apple, « [NSWindow.Level](https://developer.apple.com/documentation/appkit/nswindow/level-swift.struct?language=objc) » et « [orderFrontRegardless](https://developer.apple.com/documentation/appkit/nswindow/orderfrontregardless()) », consultés le 9 septembre 2026.
3. Apple, « [CGWindowLevelKey](https://developer.apple.com/documentation/coregraphics/cgwindowlevelkey) » et « [desktopIconWindow](https://developer.apple.com/documentation/coregraphics/cgwindowlevelkey/desktopiconwindow) », consultés le 9 septembre 2026.
4. Apple, « [NSWindow.ignoresMouseEvents](https://developer.apple.com/documentation/appkit/nswindow/ignoresmouseevents) », consulté le 9 septembre 2026.
5. Apple, « [CGEvent.tapCreate](https://developer.apple.com/documentation/coregraphics/cgevent/tapcreate%28tap%3Aplace%3Aoptions%3Aeventsofinterest%3Acallback%3Auserinfo%3A%29) » et « [CGEventTapLocation](https://developer.apple.com/documentation/coregraphics/cgeventtaplocation) », consultés le 9 septembre 2026.
6. Lhysilicon, « [Mineradio macOS event tap](https://github.com/lhysilicon/Mineradio-macOS/blob/main/desktop/mac-event-tap.js) », consulté le 9 septembre 2026.
7. Arshawn Arbabi, « [Halo EventTap](https://github.com/arshawnarbabi/Halo/blob/main/Sources/Halo/EventTap.swift) » et documentation de signature/TCC, consultés le 9 septembre 2026.
8. Libretro, « [libretro.h](https://github.com/libretro/RetroArch/blob/master/libretro-common/include/libretro.h) », callbacks vidéo/audio/entrée et sérialisation, consulté le 9 septembre 2026.
9. Dolphin Emulator, « [FIFO Player](https://dolphin-emu.org/docs/guides/) », documentation développeur, consultée le 9 septembre 2026.
10. MAME, « [Lua Scripting Interface](https://docs.mamedev.org/luascript/index.html) » et « [Lua Device Classes](https://docs.mamedev.org/luascript/ref-devices.html) », version 0.289, consultés le 9 septembre 2026.
11. DuckStation, « [Texture Replacement](https://github.com/stenzek/duckstation/wiki/Texture-Replacement) », limites et formats de dump, consulté le 9 septembre 2026.
12. Ghidra, « [AnalyzeHeadless](https://ghidra.re/ghidra_docs/api/ghidra/app/util/headless/AnalyzeHeadless.html) » et « [HeadlessOptions](https://ghidra.re/ghidra_docs/api/ghidra/app/util/headless/HeadlessOptions.html) », consultés le 9 septembre 2026.
