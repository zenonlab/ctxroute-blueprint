# Préflight de stack : notre intégration, des briques réutilisées

Étude du 7 septembre 2026, sans installation ni compilation produit. Les contrats
C0–C6 et ADR-0035/0038 restent inchangés. Ce document précise les candidats et les
preuves nécessaires ; il ne décide pas d'un langage ou moteur de production.
Lire d'abord [la faisabilité OS et MAC-01](os-feasibility.md).

Direction de travail clarifiée : notre runtime ciblé, assemblé avec des
bibliothèques spécialisées et des adaptateurs natifs. Aucun moteur de jeu complet
n'est prévu par défaut. Godot reste une référence historique de comparaison,
pas une dépendance, un finaliste obligatoire ou un prototype à réaliser.

## Répartition du travail

Le [cas OoT](oot-environment-pilot.md) précise le chemin candidat hors ligne :
extracteur Python actuel de zeldaret, Fast64/Blender à éprouver pour l'inspection,
puis pont de normalisation ciblé. ZAPD n'est pas présumé l'extracteur du HEAD OoT ;
Shipwright référence Torch. Ces outils ne deviennent pas des dépendances du
wallpaper. Les contrôleurs originaux ne sont pas inclus automatiquement dans
les ressources graphiques ; réutilisation et adaptation restent qualifiées.

Développer nous-mêmes signifie posséder la composition, l'expérience, les contrats,
les politiques énergétiques et l'intégration OS. Cela n'oblige pas à réécrire
émulation VT, accès PTY, décodeurs, parsing de formats ou abstraction GPU.
Une brique est choisie pour son périmètre réel, pas pour la liste totale des
fonctionnalités de l'application dont elle provient.

| Domaine | Réutilisation candidate | Travail du produit et preuve bloquante |
| --- | --- | --- |
| Cœur et contrôle | Rust comme candidat ; bibliothèques de données validées | Identités, recettes, permissions, activation et budgets ; noyau testable sans GPU |
| Surface macOS | AppKit via objc2 ; sonde native distincte possible | Finder/Spaces/input puis cycle de présentation ; ne pas forker une UI pour obtenir une fenêtre |
| Surface Windows | windows-rs ; Lively comme référence | Explorer/DPI/redémarrage et priorité native ; pas d'API WorkerW stable présumée |
| Surface Wayland | wayland-client / Smithay client toolkit | Rôle layer-shell, événements, disponibilité réelle ; pas d'xdg_toplevel réétiqueté |
| Fenêtres ordinaires | winit candidat | Terminal/prévisualisation et événements ; ne pas lui attribuer l'intégration wallpaper complète |
| Rendu | Runtime ciblé, wgpu candidat et bibliothèques spécialisées selon les besoins | Scène représentative, animation, texte utile, surface et invalidation ; ne développer que les fonctions manquantes |
| PTY | portable-pty | Cycle des sessions, backpressure, fermeture, signalisation et liens avec l'interface |
| Émulation terminal | xterm.js ou alacritty_terminal | Interface custom, portraits, IME/accessibilité réels ; comparer des périmètres explicites |
| UI terminal | Tauri/TypeScript ou interface native à préciser | Pas de décision implicite d'embarquer WebView dans le wallpaper ; aucune UI native complète déjà sélectionnée |
| Logique de thème | Déclaratif et comportements bornés d'abord ; Wasm candidat si nécessaire | Permissions, quotas et interruptions avant code tiers ; pas de VM obligatoire pour une image statique |
| Conversion | Lecteurs/CLI existants ; langage d'adaptateur selon outil | Provenance, isolation et validation ; entièrement hors runtime |

Ne pas imposer un même langage à tous les adaptateurs : une liaison native réduite
peut être justifiée si elle simplifie l'accès OS. En revanche, chaque langage ajouté
doit avoir un rôle, une frontière, des tests et un coût de distribution explicites.
Node/npm présents dans le dépôt restent l'outillage du blueprint, pas le runtime
du wallpaper.

## Révisions repérées et portée de la recherche

Les HEAD ci-dessous ont été relevés via l'API publique GitHub, sans cloner ni
exécuter les projets. Ils rendent le repérage traçable ; ils ne sont **pas des
versions adoptées ni un audit du code à ces révisions**. Tous les dépôts étaient
non archivés lors du relevé. Une branche active n'est pas une garantie de support.

| Projet / révision repérée | Information effectivement examinée | Conséquence |
| --- | --- | --- |
| [wgpu 9920c99](https://github.com/gfx-rs/wgpu/tree/9920c99c1d885cfe68a0d4f221bd26c0947e7bf1) | Cargo racine : version workspace 30.0.0, Rust 1.93, MIT OR Apache-2.0 | Vérifier toolchain et versions publiées compatibles avant verrouillage |
| [winit a98b2b2](https://github.com/rust-windowing/winit/tree/a98b2b217c901f8776a2bdb4ebc35ea7611998ce) | README courant montre 0.31.0-beta.3 ; création de fenêtres/événements | Ne pas transformer la branche de développement en choix stable automatique |
| [objc2 0c61cfe](https://github.com/madsmtm/objc2/tree/0c61cfe589890b087efd83edf85a11b02f55225b) | Cargo workspace : 0.3.2, Zlib OR Apache-2.0 OR MIT | Vérifier séparément les crates de frameworks et les APIs nécessaires |
| [windows-rs 5a86ef5](https://github.com/microsoft/windows-rs/tree/5a86ef5de8bb97246385935845cebca57a7175c1) | Dépôt officiel de bindings Windows | Pas de résolution des comportements Explorer par le binding seul |
| [Smithay client toolkit e97622a](https://github.com/Smithay/client-toolkit/tree/e97622a8796cd2ab4f4105ab89584f2ace1f5a40) | Toolkit client Wayland | Tester connexion, rôle et durée de vie des surfaces avec le moteur |
| [portable-pty d2f3f05](https://github.com/wezterm/wezterm/blob/d2f3f05b38f26a872f4b0bfbb3d2eaa7bdfc1b0b/pty/Cargo.toml) | Crate 0.9.0, licence MIT dans son manifeste | Ne pas déduire la licence ou l'API du seul nom WezTerm |
| [alacritty_terminal d692748](https://github.com/alacritty/alacritty/blob/d692748d3f61253ebe9f5094320120d22f6a046f/alacritty_terminal/Cargo.toml) | Crate 0.26.1-dev, Apache-2.0 | Bibliothèque VT/grille, pas GUI terminée ; révision de développement |
| [Tauri 406feea](https://github.com/tauri-apps/tauri/tree/406feea75283545496ef7398c5e2f0fb9b306b64) | Cargo racine : Rust 1.90, Apache-2.0 OR MIT | Vérifier version de chaque crate, WebView et dépendances système |
| [xterm.js c58ea36](https://github.com/xtermjs/xterm.js/tree/c58ea3637f3968e0e6e79cd92cf9aace7ef89ee2) | Dépôt émulateur terminal ; métadonnée GitHub MIT | Vérifier versions du paquet et des addons ensemble |
| [Godot 1b4643a](https://github.com/godotengine/godot/tree/1b4643ae7c8778cd9fd254d838f054f5d7a1e43c) | Repère historique de moteur complet ; métadonnée GitHub MIT | Hors shortlist active ; aucune intégration ni comparaison exécutable imposée |
| [Lively c1036fe](https://github.com/rocksdanister/lively/tree/c1036feb664960722e34bf4309042c247d6a909d) | Branche par défaut core-separation ; métadonnée GitHub GPL-3.0 | Référence Windows ; vérifier licence des fichiers et mode de réutilisation avant intégration |

Les licences workspace et métadonnées GitHub ne couvrent pas automatiquement
tous les fichiers, assets ou dépendances transitives. Les cinq Cargo.toml cités
ont été lus pour leurs déclarations ; aucune revue complète de licences ni
analyse de compatibilité de distribution n'est réalisée. Avant adoption : version
publiée/commit choisi, lockfile, licences/notices, dépendances transitives, MSRV,
plateformes minimales, maintenance et politique de mise à jour.

Sources fonctionnelles complémentaires : [wgpu](https://wgpu.rs/),
[winit](https://github.com/rust-windowing/winit),
[alacritty_terminal](https://docs.rs/alacritty_terminal/latest/alacritty_terminal/),
[WebViews Tauri](https://v2.tauri.app/reference/webview-versions/),
[MainLoop Godot](https://docs.godotengine.org/en/stable/classes/class_mainloop.html).
Tauri utilise WebView2 sous Windows et WebKit sous macOS/Linux : un résultat
mesuré sur MAC-01 ne prouve pas le comportement des autres WebViews.

## Comparaisons à mener, sans surconstruire

**Rendu :** commencer par la surface native puis intégrer le minimum graphique
avec wgpu candidat. Identifier les bibliothèques utiles aux assets, animations,
mathématiques et texte avant d'écrire leurs équivalents. Une comparaison doit
résoudre une question précise, pas imposer un deuxième moteur complet. Godot
ne revient dans l'étude active que si un manque concret justifie de réexaminer
cette option, avec son coût OS et énergétique ; aucun travail n'en dépend actuellement.

**Terminal :** Tauri/xterm.js reste un candidat complet d'interface. Pour la voie
native, commencer par l'inventaire des briques manquantes autour de la grille :
rendu texte, fonts/fallbacks, sélection, IME, presse-papiers et accessibilité.
Si aucun assemblage raisonnable n'est identifié, le signaler avant de prétendre
avoir un second finaliste comparable. Ce constat ne donne pas automatiquement
victoire à Tauri ; il rend visible l'investissement nécessaire à notre liberté.

**Adaptateurs :** vérifier le cycle de vie du handle et de la surface avant la scène
riche. [wgpu impose](https://docs.rs/wgpu/latest/wgpu/enum.SurfaceTargetUnsafe.html)
que les handles utilisés par une création unsafe restent valides jusqu'à la
destruction de la surface. Le moteur et l'adaptateur peuvent être couplés en privé,
mais C0–C3 restent indépendants. Ni partage zero-copy ni surface interchangeable
sans adaptation ne sont acquis.

## Sobriété de l'assemblage

### Points techniques déjà documentés

- winit distingue attente d'événement, attente jusqu'à une échéance et polling.
  L'attente seule ne supprime pas les réveils causés par nos timers, animations ou
  autres threads : instrumenter ces sources plutôt que déclarer la sobriété d'après
  le nom du mode. [ControlFlow](https://docs.rs/winit/latest/winit/event_loop/enum.ControlFlow.html).
- Tauri documente les Channels pour les flux ordonnés et des échanges binaires.
  Le candidat terminal ne doit pas être pénalisé artificiellement par un événement
  JSON par caractère ; tester un transport approprié avec buffers bornés.
  [Channels](https://v2.tauri.app/develop/calling-frontend/),
  [échanges avec Rust](https://v2.tauri.app/develop/calling-rust/).
- xterm.js traite `write` de façon asynchrone. Le retour de l'appel n'est pas un
  acquittement de consommation. Son guide utilise callbacks et seuils haut/bas :
  la régulation doit couvrir PTY, transport et consommateur. Ne pas confondre le
  callback de parsing et une preuve de pixels présentés à l'écran.
  [Flow control xterm.js](https://xtermjs.org/docs/guides/flowcontrol/).

Ce sont des contraintes de montage des futurs essais, pas des mesures du produit.
La voie native doit également borner ses files et traiter correctement Unicode,
IME, sélection et accessibilité ; une grille dessinée ne prouve pas ces fonctions.

### Systèmes à ne pas démarrer inutilement

Beaucoup de capacités disponibles ne signifie pas beaucoup de services actifs.
Le futur benchmark doit vérifier les systèmes absents autant que ceux présents :

- Wallpaper seul : aucun terminal, PTY ou WebView de terminal démarré.
- Image statique : aucune simulation/VM de thème ni cadence de rendu inutile.
- Scène animée : seuls les systèmes et ressources sélectionnés sont actifs.
- Audio absent ou coupé selon profil : pas de flux audio entretenu sans nécessité.
- Terminal fermé : la politique de sessions est explicite, pas un processus résiduel
  introduit pour satisfaire une dépendance du wallpaper.
- Convertisseur et IA : jamais nécessaires après préparation du thème.
- Pas de doublon de boucle d'événements ou de contexte GPU sans justification mesurée.

Pas de base de données serveur, service distant, bus générique, runtime Wasm,
pile vidéo ou décodeur ajouté par anticipation. Le stockage, scripting et les formats
exécutables restent à choisir au moment où leurs besoins sont établis.

## Conditions avant adoption

Qualifier aussi les [interactions objet/UI](../architecture/theme-interactions.md) :
layout, widgets, texte, focus/IME, accessibilité et présentation des panneaux.
Le coût de ces fonctions doit figurer dans l'assemblage comparé, même en mode
wallpaper seul. Un moteur de rendu ou une crate VT ne couvre pas implicitement
cette UI. Réutiliser les briques adaptées sans imposer Godot ou une WebView ;
la chaîne minimale I01 est une preuve E2 avant adoption du socle.

1. MAC-01 et les autres cibles de première livraison ont leurs capacités natives
   testées, ou leurs limites explicitement acceptées et publiées.
2. Les versions compatibles entre elles sont fixées, avec outil de compilation
   disponible, build reproductible et licences vérifiées au périmètre distribué.
3. B-R et les tests de remplacement concernés ont des résultats ; le terminal est
   décidé à son étape B-T/E4, pas comme dépendance du premier wallpaper.
4. L'effort spécifique est décrit par fonctions manquantes et risques, pas par
   promesse de gain en mois ou de consommation sans mesure.

Conclusion : conserver le cœur et les contrats sous notre contrôle, puis choisir
les briques à partir des surfaces OS réellement utilisables. Le présent préflight
réduit l'incertitude documentaire ; il ne ferme ni E1, ni le choix de stack.
