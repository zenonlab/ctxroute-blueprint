# Infrastructure locale et organisation du produit

État : architecture de référence proposée le 7 septembre 2026 ; responsabilités
formalisées, hypothèses techniques à comparer, aucune dépendance
produit installée. Le dépôt reste `template` jusqu'aux choix exécutables.
Voir [ADR-0033](../decisions/ADR-0033-runtime-boundaries-and-evaluation.md),
le [schéma runtime](src/runtime-infrastructure.architecture.json) et le
[pipeline de conversion séparé](game-transformation.md).
Le recadrage [ADR-0034](../decisions/ADR-0034-theme-first-and-on-demand-discovery.md)
prime : créer des thèmes, préparer les dépendances par découverte IA à la demande,
puis comparer les technologies. L'assemblage ci-dessous est une hypothèse
antérieure conservée, sans priorité actuelle ni adoption.

La priorité utilisateur est désormais **énergie minimale d'abord, personnalisation
ensuite**. Voir [ADR-0035](../decisions/ADR-0035-platform-capabilities-and-energy.md).
La recommandation à éprouver est un wallpaper natif Rust/wgpu/WGSL, séparé du
terminal Tauri/TypeScript/xterm.js avec portable-pty. Ce n'est pas une adoption :
comparer son coût de développement et ses mesures à un moteur existant. wgpu
fournit une [abstraction graphique portable](https://wgpu.rs/), pas l'ancrage
desktop ni un moteur de scènes complet. Aucun gain énergétique n'est encore mesuré.

## Découpage des responsabilités

| Module | Possède | Ne doit pas posséder |
| --- | --- | --- |
| Convertisseur local | Identification, lecteurs, extraction, normalisation, validation et provenance | Sessions terminal, hooks desktop, rendu permanent |
| Adaptateurs d'ingestion | Connaissance d'un format/moteur/jeu/version ; traduction des relations | Règles communes de thème ou exceptions console dans le runtime |
| Bibliothèque canonique | Sources récupérées, identités et dépendances préservées | État des sessions ou ressources simplifiées remplaçant les originales |
| Préparateur de composition | Résolution de recette, capacités, dérivés et cache sélectionné | Lancement libre de commandes système |
| Contrôle local | Thème actif, associations, permissions, orchestration des modules | Parsing de ROM ou moteur physique du jeu original |
| Sessions | Identité stable, cycle de vie des PTY/processus et flux bornés | Apparence des personnages ou données du jeu |
| Interface terminal | Affichage terminal, saisie explicitement focalisée, portraits et disposition | Accès implicite des scripts importés au shell |
| Hôte de scène | Rendu 2D/3D, animations, audio, picking et comportements autorisés | PTY, conversion, lancement direct d'applications |
| Adaptateur de bureau | Ancrage des surfaces, événements OS et capacités de visibilité/input | Identifiants de jeux ou interprétation de recettes |

Une ligne n'est pas un microservice. Sessions, permissions et contrôle peuvent
être des modules du même processus local. Le convertisseur reste un exécutable
séparé. Un hôte de scène séparé est la piste de prototype pour réutiliser un
moteur existant et isoler son arrêt des shells ; ce n'est pas une sandbox à lui
seul. Ne pas créer un démon par console, par session ou par moniteur.

Le schéma regroupe les détails par responsabilité ; les liens nommant des
commandes et événements représentent un échange dans les deux sens, pas une
promesse de protocole réseau ni un diagramme de séquence.

## Hypothèse technique antérieure à comparer

Hypothèse, sans préférence figée : **contrôle Rust, terminal Tauri/xterm.js
avec portable-pty, hôte de scène Godot et adaptateurs desktop par environnement**.
La motivation est de réutiliser un terminal et un moteur de scène au lieu de
réécrire les deux. Cette combinaison peut être moins économe qu'une intégration
native spécialisée ; elle doit passer les preuves ci-dessous avant engagement.

| Brique | Candidat évoqué | Ce que nous devons encore écrire ou vérifier |
| --- | --- | --- |
| Contrôle local | Rust, partagé avec le backend Tauri | Associations, permissions, messages et cycle de vie ; pas un framework générique d'agents. |
| Interface terminal | Tauri 2, TypeScript et xterm.js | HUD de sessions et configuration ; aucune nécessité de Next.js, serveur web ou framework UI supplémentaire à ce stade. |
| Pseudo-terminaux | portable-pty | Flux, redimensionnement, fermeture, pression de sortie et différences OS. Un PTY n'est pas un interpréteur de terminal. |
| Hôte 2D/3D | Godot, export sans éditeur | Import des ressources préparées et comportements bornés ; étudier Compatibility et Mobile sur la même scène. |
| Ancrage desktop | Adaptateurs propres à Windows, macOS et aux environnements Linux | Frontière la plus risquée : surface native, input et occlusion ; aucun « plugin universel » présumé. |
| Ingestion | CLI d'outils existants, orchestrée hors ligne | Adaptateurs minimaux ; Python acceptable ici sans l'imposer au runtime permanent. |
| Stockage | Fichiers locaux et manifests versionnés au départ | Écritures atomiques, références, cache par contenu et migrations ; SQLite seulement si les recherches mesurées le justifient. |
| Distribution | Application, outils et recettes versionnés séparément | Installation par OS, signatures, licences et mises à jour à qualifier ; aucun hébergement de ROM. |

[Tauri](https://v2.tauri.app/reference/webview-versions/) repose sur les WebViews
système ; ses [capabilities](https://v2.tauri.app/security/capabilities/) encadrent
l'accès de l'interface aux commandes exposées. Cela ne rend pas sûr tout code
importé. [portable-pty 0.9.0](https://docs.rs/portable-pty/0.9.0/portable_pty/)
expose une API PTY multiplateforme issue de WezTerm ; aucun test produit ici.

Godot dispose de [rendus 2D/3D adaptés à différents matériels](https://docs.godotengine.org/en/stable/tutorials/rendering/renderers.html)
et de [GLTFDocument](https://docs.godotengine.org/en/stable/classes/class_gltfdocument.html).
Son [mode de faible utilisation CPU](https://docs.godotengine.org/en/stable/classes/class_os.html#class-os-property-low-processor-usage-mode)
est un mécanisme à tester, pas une garantie de 0 FPS effectif ni d'autonomie.
Un GLB importable ne prouve pas la restitution des combinateurs rétro, UV animées
ou collisions. Le moteur doit consommer les contrats canoniques sans imposer
ses scènes propriétaires comme seule archive du jeu.

### Alternatives à comparer, pas à cumuler

- WezTerm configuré/étendu : réutilisation maximale si le HUD souhaité reste
  possible ; moins de liberté qu'une interface custom à démontrer.
- Rendu web réutilisant des lecteurs existants : intégration visuelle au terminal
  potentiellement plus simple, mais coût et intégration WebView à mesurer.
- Rust/wgpu spécialisé : contrôle plus fin, mais charge de développement du
  moteur, des imports, animations et outils. Candidat prioritaire à éprouver
  depuis la clarification énergétique ; ne pas développer deux moteurs complets
  simultanément ni présumer qu'un langage garantit la consommation.
- Lively sous Windows : candidat d'adoption/intégration ou référence d'ancrage,
  pas une dépendance à imposer à Linux/macOS.

Sources : [WezTerm](https://wezterm.org/),
[noclip.website](https://github.com/magcius/noclip.website),
[Lively](https://github.com/rocksdanister/lively).
Leur existence ne prouve pas la faisabilité de notre assemblage.

## Intégration desktop par OS

| Environnement | Piste | Preuve bloquante avant support annoncé |
| --- | --- | --- |
| Windows | Réutilisation Lively ou adaptateur natif inspiré de ses mécanismes | Explorer redémarré, icônes et clics, DPI, multi-écrans ; WorkerW non traité comme API stable garantie. |
| Wayland avec layer-shell | Adaptateur utilisant un client existant, dont Smithay client toolkit à évaluer | Détection réelle du protocole, surface de rendu du moteur, coordonnées/input et bureaux couverts par un autre client. |
| GNOME Wayland | Intégration Shell dédiée à étudier | Ne pas annoncer le support via layer-shell ; extension et transport graphique encore non prouvés. |
| X11 | Adaptateur desktop distinct | Coexistence avec le gestionnaire de bureau/icônes ; pas d'équivalence avec Wayland. |
| macOS | Adaptateur AppKit à éprouver | Niveau de fenêtre visible, Finder, Spaces, multi-écrans et permissions input ; pas de promesse fondée sur un simple numéro de niveau. |

[GTK4 Layer Shell](https://github.com/wmww/gtk4-layer-shell) documente notamment
KDE Wayland et plusieurs familles de compositeurs, mais pas GNOME Wayland ni X11.
C'est une preuve du découpage nécessaire, pas un choix d'ajouter GTK4 au moteur.
[Smithay client toolkit](https://github.com/Smithay/client-toolkit) constitue une
piste client Wayland. Ancrer une fenêtre Godot/Tauri dans ce protocole n'est pas
automatiquement possible : vérifier le chemin natif avant de retenir le moteur.

Si l'ancrage d'un environnement manque, proposer une prévisualisation en fenêtre
et annoncer le wallpaper non supporté ; ne pas détourner les entrées globales
pour simuler silencieusement la compatibilité.

### Matrice de qualification par fonctionnalité

État au 7 septembre 2026 : **aucun support produit testé ou certifié**.
« Candidat » signifie une piste d'intégration, pas une fonctionnalité disponible.
La matrice définit le banc d'essai ; elle ne promet ni toutes les versions des
OS, ni tous les pilotes, matériels ou compositeurs. Mobile, consoles et autres
OS ne sont pas dans ce banc desktop. Convertibilité d'un jeu et support de l'OS
d'affichage sont deux qualifications indépendantes.

| Fonction à qualifier | Windows | macOS | GNOME Wayland | KDE Wayland | Sway Wayland | X11 |
| --- | --- | --- | --- | --- | --- | --- |
| Recette commune, références locales | Prévu | Prévu | Prévu | Prévu | Prévu | Prévu |
| Terminal et sessions indépendants | Prévu | Prévu | Prévu | Prévu | Prévu | Prévu |
| Prévisualisation en fenêtre | Prévue | Prévue | Prévue | Prévue | Prévue | Prévue |
| Wallpaper sous les icônes/fenêtres | Adaptateur Explorer candidat | Adaptateur AppKit candidat | Intégration Shell à prouver | Layer-shell candidat | Layer-shell candidat | Adaptateur desktop candidat |
| Clic sans voler le focus | Filtrage bureau à prouver | Routage et permissions à prouver | Routage Shell à prouver | Pointeur si surface exposée, à tester | Pointeur si surface exposée, à tester | Coexistence avec gestionnaire d'icônes à prouver |
| Suspension pour occlusion | Détection à prouver | Détection à prouver | Coopération Shell à prouver | Signal disponible à vérifier | Signal disponible à vérifier | Détection à prouver |
| Multi-écrans, DPI, espaces, reprise | À tester | À tester | À tester | À tester | À tester | À tester |

KDE et Sway ont chacun leur ligne : un protocole commun ne certifie pas les
mêmes comportements. GNOME n'hérite pas du support layer-shell. Les limites du
protocole sont documentées par [GTK4 Layer Shell](https://github.com/wmww/gtk4-layer-shell#supported-desktops).
Hyprland, Niri, COSMIC et les autres environnements devront obtenir leurs propres
preuves ; cette matrice est extensible, pas une interdiction de les ajouter.
Les WebViews [diffèrent selon l'OS dans Tauri](https://v2.tauri.app/reference/webview-versions/) :
tester le terminal aussi, pas seulement la compilation de son backend.

### Capacités et replis obligatoires

L'adaptateur rapporte séparément ancrage, pointeur sûr, visibilité par écran et
reprise des surfaces, avec statut disponible, indisponible ou inconnu et motif.
Le contrôle choisit le mode ; l'hôte applique son budget. Une capacité inconnue
ne devient jamais vraie par défaut. Les noms de champs et le transport ne sont
pas encore un schéma API adopté.

- Ancrage absent : terminal seul ou prévisualisation en fenêtre, clairement
  nommée ; ne pas annoncer un wallpaper opérationnel.
- Pointeur sûr absent ou permission refusée : décor ambiant non cliquable ;
  actions accessibles depuis le terminal/contrôle, aucune capture clavier globale.
- Visibilité inconnue : ne pas prétendre détecter toutes les occultations.
  Profil économe borné et pause manuelle disponibles ; pas de polling intensif
  ni d'élévation de privilèges pour obtenir une parité artificielle.
- Surface perdue, écran débranché ou Shell redémarré : arrêter les soumissions
  concernées, recréer seulement si possible, sinon signaler le repli ; garder
  les sessions terminal indépendantes. Ne jamais dessiner au-dessus d'une session verrouillée.
- Action système indisponible : association désactivée et motif visible.
  Les recettes utilisent des intentions portables résolues localement, pas une
  commande `xdg-open` imposée à tous les OS.

L'inactivité souris seule ne signifie pas image inchangée : une animation continue
requiert encore des images. Rendre sur invalidation pour le statique, borner le
framerate pour l'animé, suspendre les soumissions lors d'une occultation connue.
Cela ne garantit pas zéro watt : compositeur, audio et terminal ont leurs coûts.
Pas d'animation à 144 Hz par défaut ; audio et effets coûteux restent optionnels.

### Preuve requise pour annoncer un support

Pour chaque ligne et fonctionnalité, enregistrer version/build OS, architecture
CPU, compositeur et version, GPU/pilote/backend, écrans/DPI/fréquences,
permissions, version produit et dépendances, scénario, résultat et date.
Statuts publiés : non testé, expérimental, validé sur configuration précise,
ou indisponible. Une CI de compilation ne vaut pas validation desktop.

Le banc utilisera une même scène synthétique originale, sans ROM : statique,
animée et masquée ; terminal seul, wallpaper seul et ensemble. Tester saisie/IME,
icônes, refus de permissions, plein écran, plusieurs écrans dont un seul masqué,
verrouillage, veille/reprise et redémarrage du Shell. Mesurer sur matériel réel
CPU par processus, temps GPU, mémoire/VRAM, réveils, latence et énergie incrémentale
par rapport au bureau natif, à luminosité et charge comparables. Documenter durée,
répétitions et variabilité ; les seuils 1–2 % restent des cibles à contextualiser.

Les versions minimales, architectures CPU, machines et ordre des PoC sont encore
à choisir. Une version non testée ne reçoit pas automatiquement le statut de sa
famille. Toute modification de l'intégration native exige les tests concernés.

## Flux, permissions et durée de vie

Le contrôle charge une composition validée et ne passe à l'hôte que la sélection
nécessaire. L'hôte remonte des identifiants d'ancre ; le contrôle vérifie leur
association et l'autorisation avant d'agir sur une session ou une application.
Les états de session distribués au décor sont minimaux : ID, sélection et états
explicitement disponibles. Ne pas envoyer le contenu des terminaux au thème.

Préférer appels internes aux modules d'un processus. Entre contrôle et hôte,
évaluer un IPC local borné (pipes/socket local) avec identité du pair, messages
versionnés, taille maximale et gestion de surcharge. Aucun port TCP public,
Redis, bus cloud ou Kubernetes n'est nécessaire. Le transport exact reste ouvert.

Les flux PTY restent ordonnés et soumis à backpressure ; on peut fusionner des
mouvements de souris ou états de survol, pas perdre arbitrairement du texte.
Éteindre le décor ne ferme pas les shells. La persistance après arrêt complet
de l'application/redémarrage reste une décision distincte, pas une propriété
garantie de portable-pty. Un thème ne reçoit ni handles PTY ni token IPC privilégié.

La composition par code n'autorise pas l'exécution aveugle d'un script téléchargé.
Premier contrat à viser : recette compilée en données et actions typées ; code
de préparation explicitement approuvé, hors processus privilégié. Aucun script
Godot ou contenu WebView distant importé ne doit obtenir les droits de l'application.
La [sécurité xterm.js](https://xtermjs.org/docs/guides/security/) rappelle que le
contexte contenant le terminal est sensible ; isoler contenus/thèmes non fiables.

## Organisation cible des sources et données

Arborescence proposée, non créée avant initialisation et choix des dépendances :

```text
apps/
  desktop/             # contrôle local et lancement des modes
  converter/           # CLI hors ligne indépendante
packages/
  contracts/           # messages et manifests, sans dépendance au moteur
  sessions/            # PTY, identités, cycle de vie
  terminal-ui/         # affichage et sélecteur de sessions
  composition/         # résolution et dérivés
  scene-host/          # intégration du moteur retenu
  desktop-platform/    # Windows, macOS, X11, Wayland, GNOME séparés
adapters/
  formats/             # lecteurs communs réutilisables
  games/               # placements et sémantique par jeu/version
themes/                # recettes et ressources originales/autorisées seulement
tests/
  contracts/           # fixtures synthétiques sans données de ROM
  integration/         # modules assemblés
  platform/            # comportements natifs par OS
  performance/         # scénarios et mesures reproductibles
```

Ne pas déplacer les packages du blueprint dans cette étape. Leurs outils et
leur SQLite ne sont pas ceux du produit. Les dossiers produit seront créés quand
ils contiendront une implémentation utile, pas pour matérialiser des cases vides.

Hors dépôt, dans un emplacement choisi par l'utilisateur : bibliothèque canonique
privée, dérivés/cache reconstruisibles et configuration personnelle séparés.
Les exports de recettes ne parcourent pas ces répertoires privés. Aucun chemin
personnel, ROM, asset extrait ou contenu de session ne va en Git ou CI publique.
La politique de conservation locale reste à confirmer selon ADR-0032.

## Preuves à exécuter avant adoption de la stack

| Preuve | Critère de décision |
| --- | --- |
| Terminal | Shell + TUI + Unicode/IME, clavier, sélection, resize et forte sortie sans blocage ; deux sessions stables pendant changement de thème. |
| Surface native | Scène synthétique ancrée sans vol de focus ; occlusion et multi-écrans testés sur chaque environnement annoncé. |
| Moteur | Comparer Godot aux exigences sur une même scène 2D puis 3D, sans implémenter un second moteur complet. |
| Énergie | Mesurer mémoire, CPU/GPU et énergie en terminal seul, scène seule, intégré, animé et masqué ; inclure coût WebView et IPC. |
| Import | PoC OoT : géométrie, acteur, collision, audio et placements ; aucune ROM requise pour les premières preuves terminal/surface. |
| Sécurité | Recette malveillante, accès fichier hors périmètre, commande non autorisée, message surdimensionné, processus scène interrompu. |
| Distribution | Installation séparée convertisseur/runtime, outils versionnés, fonctionnement hors ligne une fois installés, audit des licences. |

Mesurer aussi si deux surfaces du même décor dupliquent VRAM ou rendu. Préférer
un propriétaire de l'état de scène, transmettre des événements plutôt que des
captures vidéo, et ne pas rendre à 144 Hz par défaut. En terminal seul, ne pas
démarrer le moteur ; en bureau seul, ne pas créer de PTY ou interface terminal
inutile. Les budgets numériques seront fixés sur le matériel sélectionné.

Prochaine action : comparer l'existant pour créer et activer un package de thème
wallpaper/terminal, puis choisir la stack et le banc d'essai. Aucune installation de dépendances ou
implémentation n'a été effectuée dans cette phase documentaire.

## Sources et consultation

Sources primaires consultées le 7 septembre 2026, liées aux affirmations ci-dessus.
Les pages Godot « stable » et Tauri 2 sont des références documentaires, pas des
versions verrouillées. Relever versions et licences exactes au démarrage du PoC.
Schéma français, interface fixe du visualiseur en anglais (repli Archify).
HTML attendu : `dist/architecture/runtime-infrastructure.architecture.html`.
