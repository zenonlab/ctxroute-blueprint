# Synthèse contradictoire des audits d'architecture

État : consolidation documentaire du 7 septembre 2026, sans benchmark produit.
Les rapports transmis dans la conversation sont des contributions externes : le
premier indique ne pas avoir eu accès aux fichiers du dépôt. Leurs estimations
ne constituent donc ni un audit du code existant, ni des résultats expérimentaux.
Cette synthèse conserve les conclusions utiles et leur disposition, sans recopier
les affirmations ensuite corrigées comme des décisions.

## Disposition des conclusions

| Sujet | Disposition retenue | Référence opérationnelle |
| --- | --- | --- |
| Énergie avant richesse graphique | Confirmé ; mesurer le surcoût face au bureau natif, pas seulement les FPS | Protocole B-R |
| Abandon automatique de wgpu ou de Tauri | Non retenu ; comparer des candidats à périmètre fonctionnel explicite | Protocole B-R/B-T |
| Remplacer toute 3D par de la vidéo | Non retenu ; la recomposition et les interactions restent des besoins produit | Contrats C0–C2 |
| Sept contrats assimilés à sept démons | Lecture incorrecte ; responsabilités logiques, appels internes lorsque possible | Contrats C0–C6 |
| Wallpaper indépendant des sessions | Confirmé ; actions locales autorisées sans terminal, sessions conditionnelles | Infrastructure locale |
| Séparation des processus = persistance universelle | Faux ; isoler les pannes du wallpaper, pas garantir la survie à toute panne système | Protocole B-F |
| Ingestion dans le runtime | Déjà exclue ; CLI local optionnel, découverte IA hors affichage | Transformation du jeu |
| Conversion universelle garantie | Non retenu ; preuves par adaptateur, format et version | Contrat C6 |
| Fusion des assets privés et du thème | Interdite ; package partageable distinct de la bibliothèque privée et des caches | Contrats C0/C1/C6 |
| Wasm obligatoire et intrinsèquement sûr | Non retenu ; candidat à évaluer avec permissions et budgets | Sécurité ci-dessous |
| Compatibilité totale de tous les bureaux | Non prouvée ; qualification par capacité et configuration | Protocole B-O |
| Gains en mois, lignes de code, Mo ou pourcentages issus des rapports | Extrapolations sans valeur d'acceptation pour notre produit | Protocole de mesure |

Les identifiants B-* renvoient au [protocole expérimental](../04-experimental-protocol.md).
Les contrats restent dans [module-contracts.md](../architecture/module-contracts.md).
La séparation du convertisseur est une frontière technique : elle ne constitue
pas une garantie juridique ni une autorisation de redistribuer les données privées.
Le périmètre de diffusion et les licences de chaque dépendance doivent être vérifiés
avant distribution ; aucun avis juridique général n'est déduit de ces audits.

## Corrections techniques et sources primaires

### Entrées et ancrage

- Wayland : `set_input_region(NULL)` rétablit une région infinie. Pour une surface
  passive, créer un `wl_region` sans rectangle, l'assigner puis appliquer l'état par
  `commit`. La région est copiée par la requête et son objet peut être détruit après
  assignation. Cela ne fournit pas un suivi global du curseur à la surface passive.
  [Spécification wl_surface](https://wayland.freedesktop.org/docs/html/apa.html#protocol-spec-wl_surface-request-set_input_region).
- Windows : `WS_EX_TRANSPARENT` concerne notamment l'ordre de peinture des fenêtres
  sœurs du même thread ; `HTTRANSPARENT` recherche des fenêtres du même thread.
  Aucun des deux n'est une preuve de traversée des clics vers Explorer dans un autre
  processus. Un masque de région ne résout pas à lui seul la superposition des icônes.
  [Styles étendus](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles),
  [WM_NCHITTEST](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest).
- macOS : `ignoresMouseEvents` concerne toute la fenêtre. Un `hitTest` de vue
  retournant `nil` n'est pas une preuve de routage vers le Finder. L'occlusion doit
  être éprouvée dans les Spaces et avec les fenêtres translucides ; le drapeau de
  visibilité n'est pas une certification du wallpaper.
  [NSWindow ignoresMouseEvents](https://developer.apple.com/documentation/appkit/nswindow/ignoresmouseevents),
  [Occlusion visible](https://developer.apple.com/documentation/appkit/nswindow/occlusionstate-swift.struct/visible).
- Wayland : vérifier les interfaces annoncées au registre et les capacités réelles
  du compositeur. L'absence de layer-shell est un résultat exploitable, pas une
  invitation à lier une interface absente. Le support de layer-shell ne prouve ni
  l'accès global au pointeur ni la connaissance de toute l'occlusion du bureau.
  GNOME reste une cible séparée : repli statique/fenêtré ou extension optionnelle
  à qualifier, pas promesse de parité client native.
  [Compatibilité gtk4-layer-shell](https://github.com/wmww/gtk4-layer-shell#supported-desktops).

### Rendu, terminal et réutilisation

Les catégories statique, 2D, vidéo et 3D décrivent des possibilités d'expression,
pas un classement énergétique. Zéro présentation ne prouve pas un surcoût nul.
Les coûts du compositeur, de la mémoire et de la résidence GPU font partie du banc.

| Brique candidate et dépôt | Ce qu'elle apporte | Ce qu'elle ne prouve pas |
| --- | --- | --- |
| [wgpu](https://github.com/gfx-rs/wgpu) | Abstraction graphique multi-backend | Graphe de scène, animations, texte, ancrage desktop ou sobriété déjà résolus |
| [sokol](https://github.com/floooh/sokol#core-libraries) | `sokol_gfx` : abstraction graphique bas niveau | Chargeur glTF, hiérarchie et animation de personnages fournies |
| [tiny-skia](https://github.com/linebender/tiny-skia) | Rastérisation 2D logicielle CPU | Rendu GPU direct sans upload |
| [Vello](https://github.com/linebender/vello) | Famille de rendus vectoriels GPU, CPU et hybride ; préciser la variante évaluée | Moteur de scène 3D ou intégration desktop complète |
| [cosmic-text](https://github.com/pop-os/cosmic-text), [glyphon](https://github.com/grovesNL/glyphon) | Briques de texte, mise en forme et rendu/cache GPU | Terminal complet, IME et accessibilité OS automatiquement intégrés |
| [Bevy](https://github.com/bevyengine/bevy), [Godot](https://github.com/godotengine/godot) | Moteurs existants à encapsuler et profiler | Sous-ensemble isolable sans effort ou boucle sobre par défaut |
| [mpv](https://github.com/mpv-player/mpv) | Lecture multimédia et chemins de décodage matériel | Zero-copy, codec matériel disponible ou gain énergétique systématique |
| [Tauri](https://github.com/tauri-apps/tauri), [xterm.js](https://github.com/xtermjs/xterm.js) | Conteneur applicatif et émulateur terminal réutilisable | Coût IPC négligeable, conformité identique sur toutes les WebViews |
| [Alacritty](https://github.com/alacritty/alacritty) | `alacritty_terminal` : émulation VT et grille | Interface, rendu typographique et intégration OS terminés |
| [Rio](https://github.com/raphamorim/rio), [Ghostty](https://github.com/ghostty-org/ghostty), [WezTerm](https://github.com/wezterm/wezterm) | Alternatives à examiner pour réutilisation | API d'embarquement stable, même couverture OS ou même effort d'intégration |

Cette liste est une orientation de recherche, pas une nomenclature de dépendances
adoptées. Pour chaque candidat finaliste, relever version/commit, licence et
obligations de distribution, API réellement disponible, plateformes, dépendances
transitives, fonctionnalités manquantes et coût de sortie. Ne pas développer un
terminal complet uniquement pour comparer une bibliothèque de grille à xterm.js.

Le [manuel mpv hwdec](https://mpv.io/manual/stable/#options-hwdec) distingue les
chemins de décodage et les variantes avec copie. Une vidéo peut reproduire une
trajectoire de caméra prédéfinie ; elle ne remplace pas une scène arbitrairement
recomposable. La [documentation alacritty_terminal](https://docs.rs/alacritty_terminal/latest/alacritty_terminal/)
permet de délimiter l'émulation fournie et le travail d'interface restant.

### Sécurité de la logique et des données

Wasm demeure une option, pas une adoption. Une intégration doit limiter mémoire,
durée/quotas, appels hôte, accès aux ressources et messages. Les interruptions
fuel/époques ont un coût à mesurer ; une fonction hôte bloquante ou trop puissante
reste un risque. Aucun thème ne reçoit un accès implicite au shell ou au réseau.
[Sécurité Wasmtime](https://docs.wasmtime.dev/security.html),
[Interruptions Wasmtime](https://docs.wasmtime.dev/examples-interrupting-wasm.html).

La recherche IA de dépôts publics et l'exécution d'un convertisseur sont des phases
distinctes. Installation et provenance contrôlées d'abord ; conversion locale
isolée ensuite. Aucun audit ne justifie de transférer ROM, captures, dumps ou
diagnostics privés vers un modèle distant. La validation structurelle d'un glTF
ne prouve ni la fidélité des collisions ni celle des relations extraites.

## Ce qui reste à établir

Trois questions restent expérimentales : socle de rendu réutilisé, terminal à
périmètre fonctionnel comparable, ancrage respectant les interactions natives.
Les essais doivent pouvoir conclure dans les deux sens ou rester non concluants.
Pas d'abandon de technologie, d'extension GNOME obligatoire ou de réduction du
produit sur la seule base du vocabulaire employé dans un rapport.

Voir [ADR-0038](../decisions/ADR-0038-neutral-experimental-protocol.md) pour la
décision méthodologique et [la feuille de route](../03-product-roadmap.md) pour
l'ordre d'exécution. Aucun des résultats attendus n'a encore été mesuré.
