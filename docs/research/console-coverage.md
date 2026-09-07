# Cartographie des consoles et couverture de conversion

Recherche exploratoire conservée, non liste obligatoire à compléter : depuis
[ADR-0034](../decisions/ADR-0034-theme-first-and-on-demand-discovery.md), la
préparation d'un thème peut découvrir ses outils par IA à la demande. Un jeu
absent de cette page n'est pas interdit ; aucun inventaire exhaustif n'est requis.

État au 7 septembre 2026 : recherche documentaire, aucun adaptateur exécuté dans
ce dépôt. Cette cartographie remplace l'échantillon de consoles de la discussion.
Elle couvre les grandes familles, extensions et plusieurs systèmes spécialisés ;
elle ne prétend pas inventorier chaque clone matériel ou console jamais produite.
Un système absent peut être ajouté sans changer le cœur du produit.

## Lire la compatibilité correctement

Il n'y a actuellement **aucune console certifiée convertible par notre produit**.
Les émulateurs ci-dessous sont des références possibles hors ligne, pas des
dépendances permanentes, ni des extracteurs universels. Leur présence dans une
liste ne garantit pas chaque jeu, région, BIOS, OS hôte ou fonction de débogage.
Les variantes matérielles gardent des identités distinctes même si elles
partagent un outil. Les consoles sources ne sont pas les OS du runtime.

La compatibilité sera enregistrée par `(système, jeu, version, adaptateur)` et
par capacité : identification, images/tuiles, scène 2D, géométrie 3D, matériaux,
squelettes, animations, audio, collisions, placements, relations et comportements.
Pour chacune : inconnu, non supporté, extrait, validé ou approximé, avec preuve.
Un matériau peut être validé tandis que la navigation reste non supportée.

Une image 2D n'est pas un modèle 3D ; un jeu de sprites peut alimenter un thème
2D/2.5D sans reconstruction 3D inventée. Un jeu vectoriel ou à graphismes générés
par code peut demander une adaptation spécifique plutôt qu'un export de PNG.
Une capture ne remplace ni la topologie ni les règles originales.

## Nintendo

| Système source | Référence hors ligne | État d'étude produit |
| --- | --- | --- |
| NES / Famicom | Mesen, FCEUmm [L] | Futur pilote 2D ; lecteurs par jeu/mapper. |
| Famicom Disk System | À qualifier séparément dans l'outil NES | Extension non validée ici. |
| SNES / Super Famicom | bsnes, Snes9x [L] | Tuiles, palettes, effets et coprocesseurs à distinguer. |
| Game Boy / Game Boy Color | Mednafen [M], SameBoy [L] | Conversion 2D à prouver. |
| Game Boy Advance | mGBA [L] | Conversion 2D ou 3D selon le jeu. |
| Virtual Boy | Mednafen [M] | Représentation stéréoscopique à qualifier. |
| Pokémon Mini | PokeMini [L] | Adaptateur spécialisé ultérieur. |
| Game & Watch | GW [L] ; étude machine par machine | Graphismes et logique parfois très spécifiques. |
| Nintendo 64 | Mupen64Plus-Next, ParaLLEl N64 [L] | Priorité : OoT ; SM64 alternative. Aucun résultat encore validé. |
| Nintendo 64DD | Audit séparé requis | Ne pas déduire le support de celui des cartouches N64. |
| Nintendo DS / DSi | melonDS DS [L] | Deux écrans, 2D/3D et variantes à distinguer. |
| Nintendo 3DS / New 3DS | [Azahar](https://github.com/azahar-emu/azahar) | Étude différée ; compatibilité par titre et variante. |
| GameCube / Wii | Dolphin [L] | Deuxième axe : formats et lecteurs existants, pas tout le catalogue. |
| Wii U | [Cemu](https://github.com/Cemu-project/Cemu) | Conversion non étudiée ; ne pas confondre avec Wii. |
| Switch | Aucun outil retenu dans cette étude | Audit dédié nécessaire ; aucune promesse de conversion. |
| Switch 2 | Aucun outil retenu dans cette étude | Non évalué ; ne pas extrapoler depuis Switch. |

Azahar se présente comme un émulateur 3DS dérivé de Citra. Cemu cible Wii U ;
son README décrit notamment des limitations expérimentales sur macOS. Cela
ne certifie aucun pipeline d'extraction. Sources primaires liées dans le tableau.

## Sega, Sony et Microsoft

| Système source | Référence hors ligne | État d'étude produit |
| --- | --- | --- |
| Sega SG-1000 | Gearsystem [L] | 2D à étudier. |
| Master System / Game Gear | Mednafen [M] | 2D à étudier. |
| Mega Drive / Genesis | Mednafen [M] | 2D et effets spécifiques à étudier. |
| Mega-CD / Sega CD | PicoDrive [L] | Disque, séquences et ressources partagées. |
| Sega 32X | PicoDrive [L] | Extension distincte, capacités 3D à prouver. |
| Sega Saturn | Mednafen [M] | Sprites, polygones et compositions mixtes. |
| Dreamcast | Flycast [L] | Formats et scènes par titre. |
| Dreamcast VMU | VeMUlator [L] | Périphérique programmable distinct de la scène Dreamcast. |
| PlayStation | Mednafen [M], Beetle PSX [L] | Axe 3D ultérieur, après preuve sur le pilote. |
| PlayStation 2 | [PCSX2](https://github.com/PCSX2/pcsx2) | Formats/moteurs par jeu ; aucune conversion générale. |
| PlayStation 3 | [RPCS3](https://github.com/RPCS3/rpcs3) | Référence d'émulation/débogage, ingestion non évaluée. |
| PlayStation 4 | [shadPS4](https://github.com/shadps4-emu/shadPS4) | Ne pas déduire une couverture globale du catalogue. |
| PlayStation 5 | Aucun outil retenu ici | Non évalué ; pas une déclaration d'impossibilité. |
| PSP | [PPSSPP](https://github.com/hrydgard/ppsspp) | Lecteurs spécifiques à étudier. |
| PS Vita / PlayStation TV | [Vita3K](https://github.com/Vita3K/Vita3K) | Projet d'émulation expérimental ; ingestion non évaluée. |
| PocketStation | Audit spécifique requis | Ne pas assimiler aux assets PlayStation. |
| Xbox originale | [xemu](https://github.com/xemu-project/xemu) | Ingestion non évaluée. |
| Xbox 360 | [Xenia](https://github.com/xenia-project/xenia) | Projet de recherche d'émulation ; ingestion non évaluée. |
| Xbox One / Xbox Series | Aucun outil retenu ici | Deux familles à qualifier séparément, hors pilote. |

Ces projets sont des références documentaires officielles. Aucun taux de jeux
compatibles, rythme de maintenance ou support hôte universel n'est annoncé.

## Autres consoles et systèmes spécialisés

| Système source | Référence hors ligne ou état |
| --- | --- |
| Atari 2600 | Stella [L] |
| Atari 5200 | a5200, Atari800 [L] |
| Atari 7800 | ProSystem [L] |
| Atari Lynx | Mednafen [M] |
| Atari Jaguar | Virtual Jaguar [L] |
| Atari Jaguar CD | Extension à qualifier séparément |
| NEC PC Engine / TurboGrafx-16 | Mednafen [M] |
| PC Engine CD / TurboGrafx-CD | Mednafen [M] |
| NEC SuperGrafx | Mednafen [M] |
| NEC PC-FX | Mednafen [M] |
| SNK Neo Geo AES / MVS | Geolith, FB Neo [L] |
| Neo Geo CD | NeoCD [L] |
| Neo Geo Pocket / Color | Mednafen [M] |
| Bandai WonderSwan / Color | Mednafen [M] |
| 3DO | Opera [L] |
| Philips CD-i | CDi 2015 [L] ; couverture à réévaluer |
| ColecoVision | Gearcoleco [L] |
| Intellivision | FreeIntv [L] |
| Fairchild Channel F | FreeChaF [L] |
| Odyssey² / Videopac | O2EM [L] |
| Vectrex | vecx [L] |
| Watara Supervision | Potator [L] |
| Mega Duck / Cougar Boy | SameDuck [L] |
| Epoch Cassette Vision | PD777 [L] |
| Super Cassette Vision | EmuSCV [L] |
| CreatiVision / My Vision | JollyCV [L] |
| Arduboy | Ardens [L] |
| Casio PV-1000 / Loopy, Game.com, N-Gage, Pippin, Playdate | Familles recensées mais non évaluées ; aucune chaîne proposée ici. |
| Consoles dédiées, clones et machines analogiques anciennes | Inventaire par machine requis ; une ROM exploitable n'est pas présumée. |

Toute cette section reste non validée pour la conversion. Le type d'expérience
(2D, vectorielle, vidéo ou 3D) et la disponibilité de données séparables doivent
être établis avant de promettre une scène interactive.

## Arcade, ordinateurs et consoles virtuelles

Ce sont des extensions de périmètre, pas des consoles de salon à fusionner dans
la même liste de compatibilité. [MAME](https://www.mamedev.org/about.html) décrit
une démarche de préservation couvrant de nombreuses machines, pas un format
universel d'assets. Étudier chaque carte arcade et chaque jeu séparément.

- Arcade : MAME/FB Neo ; NAOMI via Flycast [L], sans extrapoler aux autres cartes.
- Ordinateurs : DOS, Amiga, C64, MSX, ZX Spectrum, CPC, PC-98 et X68000 ont des
  références dans [L] ; ingestion par moteur/jeu, pas par simple extension disque.
- PC natif, jeux homebrew et consoles virtuelles : potentiellement des assets
  déjà documentés, à évaluer indépendamment de l'émulation matérielle.

## Réutilisation pour l'extraction, distincte de l'émulation

| Famille de données | Outils à examiner | Ce qui n'est pas acquis |
| --- | --- | --- |
| OoT / SM64 | Projets de décompilation, ZAPD, Fast64 : sources dans [la recherche du pipeline](../architecture/game-transformation.md) | Export final complet et conservation des relations à prouver. |
| GameCube / Wii | [RiiStudio](https://github.com/snailspeed3/RiiStudio), SuperBMD à qualifier | RiiStudio documente SZS, KMP/KCL vers JSON et opérations BMD/BRRES ; pas un export universel du jeu. |
| Plusieurs moteurs rétro | [noclip.website](https://github.com/magcius/noclip.website) | Référence de lecteurs/rendu ; ne pas télécharger son catalogue d'assets ni présumer une bibliothèque exportable clé en main. |
| Audio | vgmstream, à qualifier pour les jeux choisis | Une musique séquencée demande aussi séquence, banques et rendu, pas seulement décodage d'un flux. |

## Priorisation et preuve d'admission

1. OoT comme tranche 3D prioritaire ; conserver SM64 comme alternative.
2. Un titre GameCube/Wii pour tester la réutilisation entre formats et moteurs.
3. Un titre 2D à choisir pour démontrer que le contrat n'impose pas une scène 3D.
4. Élargir aux familles suivantes uniquement quand un adaptateur a une preuve.

L'admission exige : version exacte de l'entrée, révision/licence des outils,
commandes reproductibles, capacités positives/négatives, références conservées,
validation locale sans envoi de données, rendu comparé et budget mesuré.
Les firmware/BIOS/clés éventuellement requis ne sont pas fournis par le produit.
Ne pas annoncer « toutes les consoles prises en charge » à partir de cet inventaire.

## Sources transversales et limites

[L] : [catalogue primaire Libretro](https://docs.libretro.com/guides/core-list/),
consulté le 7 septembre 2026 ; inventaire de cœurs, dont certains historiques.
[M] : [documentation Mednafen](https://mednafen.github.io/documentation/), page
annoncée pour 1.32.1 ; utilisée seulement pour identifier les familles documentées.
Les correspondances système/outil sont documentaires ; priorités et architecture
de conversion sont nos propositions, sans benchmark ni ROM exécutée.
