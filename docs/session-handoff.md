# Reprise de session — Wallpaper

Mise à jour : 7 septembre 2026. Dépôt initialisé ; L1 implémenté isolément.

## Reprise actuelle — L1

Version ADR-0045 : animation demandée en bureau, contrôles via menu **WP**, même
fenêtre conservée au retour Spaces/réveil. Les tests d'état et handlers passent,
pas encore la fluidité réelle des transitions. La sonde peut suspendre l'animation
si le fond est masqué ; voir `scheduling_source` dans le reçu. Clic sur géométrie
derrière les icônes toujours non qualifié. Lire la version actuelle de la fiche L1.

Lire [la fiche d'essai](pocs/macos-surface.md) et
[ADR-0043](decisions/ADR-0043-isolated-macos-surface-poc.md).
Source autonome : `pocs/macos-surface/`, aucun lien au futur moteur ou au terminal.
Les tests Swift passent ; le smoke AppKit ne valide pas l'animation dans cette
session où la fenêtre est signalée invisible. Ne pas forcer son exécution masquée.
ADR-0044 ajoute le vrai lancement de bureau par `.app` :
`sh pocs/macos-surface/probe.sh desktop --duration 60`.
La surface est reconnue et capturée par le contrôle macOS ; sa composition avec
les icônes Finder reste à qualifier. `run` reste uniquement le diagnostic en fenêtre.
Prochaine action : vérifier les gestes Finder. L2/L3, consommation électrique et
compatibilité OS restent ouverts. Voir la fiche pour les limites du contrôle GUI.

Les sections suivantes conservent les relevés documentaires antérieurs.

## Historique — avant implémentation L1

Lire en premier le [plan L1–L3](05-poc-start-plan.md) et
[ADR-0042](decisions/ADR-0042-bounded-poc-start.md). Sonde Swift/AppKit sur MAC-01,
contrôleur Rust sans GPU, puis scène wgpu/WGSL : choix expérimentaux seulement.
Les données sont originales, les sessions simulées et les actions locales bornées.
Prochaine action : terminer l'initialisation obligatoire puis implémenter L1.
Cette session corrige les documents ; elle ne livre aucun PoC ni benchmark.
Le statut `template` n'a pas été modifié. Ne pas annoncer E2 commencé.

Vérification de cette correction : `npm run verify` réussi, 262 tests réussis,
1 ignoré, 0 échec ; 3 tests d'intégration réussis ; audit npm sans vulnérabilité.
Ces résultats portent sur l'outillage. Aucun fichier supprimé, hook modifié ou
code produit ajouté. AGENTS.md, CLAUDE.md et hooks Codex inspectés, inchangés.
Workflow Archify livré : showcase 9/9, zéro erreur/avertissement, quatre tailles
sans débordement ; capture sombre 2048×1320 inspectée, revue humaine `pending`.
Libellés français, interface fixe en anglais ; artefact :
`dist/architecture/product-roadmap.workflow.html`.
SHA-256 source : `28d1c8e8744895702ebf5a1630aff08a5857eaef4850869fc750fb761ffdf446`.
SHA-256 HTML : `ac547c768f1a51a684bd2742a663860aa807b6f8999b11819ebda2187bee1052`.

Les paragraphes et reçus suivants décrivent les étapes antérieures :

Direction actuelle : [préparation IA et comportements](architecture/ai-prepared-behaviors.md),
[ADR-0041](decisions/ADR-0041-ai-prepared-selective-behaviors.md).
Données originales + contrôleurs adaptés en priorité ; portage original au cas
par cas. Entrées 2D/3D/hybrides/custom, sans liste fermée ni conversion garantie.
L'IA prépare les liens et tests hors runtime. La course conserve vrais virages,
formation stable et récupération visuelle sans relance implicite du travail.
États inconnus/périmés explicites ; aucune télémétrie déduite du seul silence PTY.
Prochaine étape : fermer E1 avec fixtures et périmètre minimal, puis E2 trajectoire
et formation sur données originales synthétiques. Pas de ROM nécessaire à cette
preuve ; OoT reste une étude, pas le point de passage de tous les jeux.

Vérification ADR-0041 : `npm run verify` réussi (262 tests réussis, 1 ignoré,
0 échec ; 3 intégrations réussies ; 0 vulnérabilité npm). 73 cibles de liens
locaux vérifiées, aucune absente ; `git diff --check` propre. Aucun fichier
supprimé, dépendance installée ou hook modifié. Aucun test produit exécuté.
Archify architecture : showcase 9/9, aucune erreur ni avertissement ; contrôle
automatique sur quatre tailles réussi ; capture sombre 2048×1320 inspectée.
Revue humaine `pending`, viewer anglais, libellés produit français.
Artefact : `dist/architecture/game-transformation.architecture.html`.
SHA-256 source : `952c57d60dde583eae62ab1b55e907b0211bbf6395716cec70d6e7634832104f`.
SHA-256 HTML : `ab657403aa0279747b39d777f33554e634b92ebeb4670cf80d7d07f5edeebffe`.

Les comptes rendus suivants sont historiques :

Dernière étude : [OoT vers un environnement interactif](research/oot-environment-pilot.md),
[ADR-0040](decisions/ADR-0040-source-engine-and-theme-runtime.md).
Sources publiques épinglées lues : OoT utilise une extraction Python, Shipwright
référence Torch, Fast64 décrit des limites d'import et des extensions glTF draft.
Temple du Temps est le cas provisoire, pas un jeu obligatoire ni certifié.
L'étude distingue données, code original dépendant du jeu et interactions créées.
Aucune ROM fournie/cherchée, aucun outil installé/exécuté, aucun bundle extrait.
E1 reste à fermer avant code ; V1–V6 cadrent l'intégration réelle ultérieure.
L'extraction privée nécessitera un chemin local fourni et une isolation qualifiée.

Vérification de l'étude : `npm run verify` réussi (262 tests réussis, 1 ignoré,
0 échec ; 3 intégrations réussies ; 0 vulnérabilité npm). Les 17 liens de fichiers
amont du rapport ont été revérifiés via raw HTTP 200 ; les cinq liens de dépôts
pointent sur les révisions relevées par API. Aucun test d'extraction produit.
Archify architecture : showcase 9/9, aucune erreur ni avertissement ; contrôle
de containment réussi sur quatre tailles, captures clair/sombre ; capture sombre
2048×1320 inspectée par l'agent. Revue humaine `pending`, viewer en anglais.
Artefact : `dist/architecture/game-transformation.architecture.html`.
SHA-256 source : `1555132720f900a729be3e92e2569368adcb76f024a771313b8e96d9dc224d9f`.
SHA-256 HTML : `519a646a3d250492f0d936d1798b42675afc29270ef84b246e2258fbca460278`.
Instructions et hooks inchangés ; aucun fichier supprimé ni dépendance installée.

Historique de cadrage et de vérification :

Dernier cadrage : [interactions programmables](architecture/theme-interactions.md)
et [ADR-0039](decisions/ADR-0039-programmable-theme-interactions.md).
Objets, géométrie et boutons peuvent ouvrir des panneaux ; leurs contrôles
pilotent animations/effets, dont les événements actualisent l'UI. C0–C2 et C5
sont précisés sans nouveau bus ni adoption de moteur. Le schéma runtime inclut
désormais scène et panneaux. Tests I01–I10 prévus, aucun code produit exécuté.
Prochaine preuve : préparer E1 puis éprouver en E2 cette chaîne minimale avec
priorité des icônes natives et budget énergétique par surface.

Vérification de cette extension : `npm run verify` réussi (262 tests réussis,
1 ignoré, 0 échec ; 3 intégrations réussies ; 0 vulnérabilité npm).
Archify showcase : 9/9, aucune erreur ni avertissement ; contrôle automatique
réussi sur quatre tailles en clair/sombre, capture sombre 2048×1320 inspectée
par l'agent. Revue humaine toujours `pending` ; commandes du viewer en anglais.
Artefact : `dist/architecture/runtime-infrastructure.architecture.html`.
SHA-256 source : `ebaf25802dceb677b59ca94e14d9f3508db9116ea4b24177a8858833c983e240`.
SHA-256 HTML : `290b4a431f3ae295598794e1d929f1b136c440febeffd836b7e0ce66f8c332ec`.
Aucun fichier supprimé, aucune dépendance installée ; instructions et hooks
inchangés. Ces contrôles valident la documentation et le socle, pas le produit.

Les comptes rendus ci-dessous concernent les mises à jour précédentes.

Clarification et preuves natives : Godot est hors shortlist active, conservé comme
référence historique seulement. Direction : runtime ciblé, bibliothèques spécialisées
et adaptateurs natifs ; pas de moteur complet imposé. Voir le
[préflight actualisé](research/stack-preflight.md).
Le [diagnostic natif MAC-01](research/os-feasibility.md#diagnostic-natif-effectivement-exécuté)
a terminé avec code 0 : écran 1512×982 points à facteur 2, maximum annoncé 120 Hz,
Metal à mémoire unifiée, préflight écoute positif pour le processus de diagnostic.
rustc/cargo 1.97.1 vérifiés sans installation automatique. Aucun rendu, fenêtre,
hook, capture, changement de permission ou benchmark produit exécuté.
Lecture ciblée de Lively documentée ; B-O08 ajoute le cas du focus refusé par l'OS.
Les contrats et sources Archify ne changent pas : précisions de recherche et de
test seulement, pas de nouvelle frontière architecturale ou dépendance adoptée.

Vérification de cette mise à jour : `npm run verify` réussi ; 262 tests réussis,
1 ignoré, 0 échec, 3 intégrations réussies et 0 vulnérabilité npm. La commande
extraite du bloc documentaire a été réexécutée avec code 0 et mêmes observations.
64 liens locaux vérifiés sur les six documents modifiés, aucun fichier cible absent.
`git diff --check` propre ; aucun fichier supprimé ni changement des hooks.

Travail précédent : [faisabilité OS](research/os-feasibility.md) et
[préflight de stack](research/stack-preflight.md). MAC-01 observé en lecture seule :
M1 Pro, 16 Go, macOS 26.2 ARM64, écran principal 3024×1964 ; SDK 26.5 et outillage
Apple accessibles. Aucun ancrage ni mesure énergie exécuté ; pas de demande de
permission, dépendance installée ou donnée matérielle identifiante conservée.
Les révisions amont sont des repères de recherche, pas une stack verrouillée.
Prochaine action : compléter fréquence/profil/instruments et budgets E1, définir
les cibles de première livraison puis préparer la sonde native macOS.
Contrats et schéma runtime inchangés : cette étude ne modifie aucune frontière
ni dépendance adoptée et ne nécessite pas de nouveau diagramme ou ADR d'adoption.

Vérification du préflight : `npm run verify` réussi (262 tests réussis, 1 ignoré,
0 échec ; 3 intégrations réussies ; 0 vulnérabilité npm). Les 83 liens locaux
des huit documents parcourus existent ; `git diff --check` propre. Les schémas
produit existants sont revalidés par le build, sans nouvelle revue visuelle puisque
leurs sources ne changent pas. AGENTS.md, CLAUDE.md et les hooks sont inchangés.

Vérification de la consolidation précédente (ba72b4f) : `npm run verify` réussi
(263 tests : 262 réussis, 1 ignoré, 0 échec ; 3 tests d'intégration réussis ;
audit npm : 0 vulnérabilité). Aucun test produit ni mesure énergétique exécuté.
AGENTS.md, CLAUDE.md et les hooks restent inchangés ; aucune suppression de fichier.

Archify : runtime showcase validé 9/9, 0 erreur/avertissement ; HTML livré sous
`dist/architecture/runtime-infrastructure.architecture.html`. Contrôle visuel
automatique réussi sur quatre tailles, captures claires/sombres ; capture sombre
2048×1320 inspectée par l'agent. La revue humaine reste `pending` dans le reçu
`dist/architecture/runtime-infrastructure.architecture.visual-check.json`.
Le viewer conserve ses commandes anglaises ; le diagramme produit est en français.
Empreinte source : `cec1c002c6ee742d2d0905a7a79210a95b595083b359f17a3c54bd687c1da16d`.
Empreinte HTML : `9e836e2556eef3816a1592bb842d2b4b8124b53fa0ebc6729d3e9c0b507b341f`.

Dernière consolidation : [ADR-0038](decisions/ADR-0038-neutral-experimental-protocol.md),
[synthèse des audits](research/architecture-audit-synthesis.md) et
[protocole expérimental](04-experimental-protocol.md). Les corrections techniques
sont séparées des hypothèses ; B-R/B-T/B-O/B-F sont prévus, aucun n'est exécuté.
Autonomie wallpaper et sessions conditionnelles précisées dans C2/C3 et le schéma.
La protection des sessions vise les pannes du wallpaper, pas une persistance
universelle. Aucun choix forcé de terminal natif, vidéo ou Wasm. La prochaine
action reste de renseigner machines/instruments/budgets E1 avant le premier PoC.

Review précédente : [ADR-0037](decisions/ADR-0037-replaceable-module-contracts.md) et
[contrats C0–C6](architecture/module-contracts.md). Propriétaires et échanges
documentés sans figer les codecs/API. E2 doit éprouver une scène représentative
et R01–R04, pas seulement un triangle. Contraintes terminal/import examinées dès
E1 par fixtures/doubles, implémentations complètes toujours en E4/E6.

Ordre de réalisation actuel : [feuille de route E1–E6](03-product-roadmap.md),
selon [ADR-0036](decisions/ADR-0036-evidence-first-roadmap.md). E1 à préparer,
aucune étape produit exécutée. Cette feuille de route remplace les anciens ordres
de discussion ci-dessous, qui restent historiques.

Décision de compatibilité : [ADR-0035](decisions/ADR-0035-platform-capabilities-and-energy.md),
énergie prioritaire et [matrice OS par fonctionnalité](architecture/runtime-infrastructure.md#matrice-de-qualification-par-fonctionnalité).
Aucun OS certifié. Rust/wgpu/WGSL pour le wallpaper natif devient la recommandation
à éprouver, terminal Tauri/xterm.js séparé ; aucune dépendance adoptée ou installée.
Prochaine action : choisir les machines/versions de référence et le premier PoC
surface native + mesure énergétique, avant de figer la stack.

Décision de périmètre : [ADR-0034](decisions/ADR-0034-theme-first-and-on-demand-discovery.md).
Nous créons des packages de thèmes pour wallpapers et terminaux custom.
Nos créations et notre logique restent séparées de la bibliothèque locale du jeu.
À la demande, l'IA recherche les dépôts publics utiles, inspecte et prépare une
chaîne isolée, puis conserve l'adaptateur et ses preuves pour réutilisation.
Pas de catalogue exhaustif à remplir, pas de jeu complet à décompiler avant
chaque thème, pas d'IA requise pour l'affichage. ROM et diagnostics privés restent
locaux. La stack et le fournisseur IA sont à discuter ensuite, sans priorité
figée à Rust/Tauri/Godot. Aucun outil découvert n'a été exécuté dans ce dépôt.

Étape antérieure : [infrastructure locale](architecture/runtime-infrastructure.md)
et [cartographie élargie des consoles](research/console-coverage.md), avec
[ADR-0033](decisions/ADR-0033-runtime-boundaries-and-evaluation.md).
Responsabilités séparées sans multiplier les démons ; organisation future des
sources et données documentée sans dossiers vides ni déplacement du blueprint.
Assemblage antérieurement proposé, désormais sans priorité : Rust/Tauri/xterm.js/portable-pty pour le
terminal et contrôle, Godot pour la scène ; intégration OS et énergie non prouvées.
Ce ne sont pas des dépendances adoptées. Aucune console n'est encore certifiée
convertible dans notre produit ; les émulateurs servent de références hors ligne.

Historique : lire aussi [la transformation du jeu](architecture/game-transformation.md)
et [ADR-0030](decisions/ADR-0030-game-transformation.md). L'utilisateur veut
programmer des compositions à partir d'une bibliothèque couvrant le jeu entier,
avec ressources, relations, collisions et comportements compris, tout en
n'exécutant que la sélection nécessaire. Mario Kart reste un exemple.
La composition par code est prioritaire. Une décision antérieure est
[ADR-0031](decisions/ADR-0031-canonical-library-and-capabilities.md) : bibliothèque
canonique préservée, indexation globale et exports progressifs par scène,
comportements ambiants adaptés, clics et réactivité système, capacités explicites,
profils énergétiques soumis à mesure. OoT est candidat prioritaire pour un PoC
avant sélection définitive du pilote. La ROM/version, la scène précise et les
machines de mesure restent à fournir ou choisir ; aucun PoC n'a été exécuté.

Lire [AGENTS.md](../AGENTS.md), la [vision produit](00-project-brief.md), puis
les [questions techniques](01-technology-decisions.md).
Dernier ajout : [ADR-0032](decisions/ADR-0032-local-conversion-and-theme-distribution.md).
Convertisseur local séparé, ROM fournie par l'utilisateur, recettes distribuées
sans assets extraits et aucun envoi de données du jeu côté fournisseur.
La bibliothèque persistante locale est une hypothèse à confirmer pour sa
conservation/purge ; ne pas confondre cette question avec le refus de collecte.
Les candidats terminal/wallpaper et la liste d'émulateurs hors ligne sont
archivés dans les questions techniques, sans adoption ni preuve d'exécution.
Le projet reste volontairement au statut `template`. Ne pas lancer
`npm run initialize` ni développer le produit avant la discussion technique.

## Ce que l'utilisateur a confirmé

- Un bureau interactif et un terminal personnalisé, avec une fusion visuelle
  mais aussi les modes terminal seul et bureau seul.
- Des sessions de shells et d'agents représentées par des joueurs sélectionnables.
- Mario Kart et la liste des joueurs en haut à droite comme exemple, pas comme
  jeu pilote ou disposition définitivement choisis.
- Des personnages interchangeables et des données de jeu isolées pour recomposer
  les thèmes ; changer d'apparence doit préserver le travail.
- Linux, macOS et Windows comme cible, avec couverture exacte encore à définir.
- Créer le moins possible nous-mêmes : examiner l'existant avant la stack.

## État du socle et provenance

Le dossier était vide. Le template a été cloné depuis
[zenonlab/ctxroute-blueprint](https://github.com/zenonlab/ctxroute-blueprint),
révision `dbfb2e054b311c642ca75cc2ec35d605a42f1c1d`.
Son historique et ses notices de licence sont conservés. Aucun dépôt distant
produit n'a été créé et aucun push n'est prévu pour cette étape.
Le remote `origin` désigne encore le blueprint amont : ne pas y pousser le produit.

Environnement observé : macOS, Node 24.18.0, npm 11.16.0, Python système 3.12.0,
uv 0.11.2, Git 2.52.0. L'environnement CRG utilise Python 3.12.10.

`npm run setup` a terminé avec succès avant les modifications documentaires :
installation verrouillée, CTXRoute 2.0.0, Archify 2.16.0, Code Review Graph 2.3.8,
construction du graphe local, activation de `.githooks` et validation du template.
La couverture globale rapportée était 91,09 % lignes, 75,44 % branches et
88,55 % fonctions. Ces mesures concernent le template.

Les manifests MCP du projet déclarent `ctxroute-orchestrator` et
`code-review-graph`. Leur présence ne prouve pas leur chargement dans le client.
À la nouvelle session ouverte depuis ce dossier, vérifier `/mcp` et approuver
les six définitions locales dans `/hooks` si Codex le demande, conformément
au [guide amont conservé](../README.md). Aucune configuration globale modifiée.

## Vérification finale

Étape contrats : source runtime C1–C5 et document C0–C6 alignés ; huit tests de
remplacement R01–R08 spécifiés, aucun exécuté en produit. Schéma architecture
Archify livré, 9 contrôles showcase réussis, 0 erreur/avertissement. Contenance
réussie aux quatre tailles desktop ; capture sombre 2048×1320 inspectée par l'agent.
Reçu automatique `visualReview: pending`, interface fixe en anglais.
Source SHA-256 `d3b3a6a10781bd3a016ec75f51c26bec3280ad7dd9713f21b13cd1e7d024d6e2`
(1783 octets), HTML SHA-256
`eeddaba389fd7bca1c00d502fd586d1444c212baa083a8ec1586b1313134428c`
(706087 octets), artefact `dist/architecture/runtime-infrastructure.architecture.html`.
Audit du diff : AGENTS.md, CLAUDE.md, .codex/hooks.json, hooks et configuration
produit inchangés ; uniquement documentation, registre documentaire et schéma.
`npm run verify` réussi : 263 tests (262 réussis, 1 ignoré, 0 échec), 3 tests
d'intégration réussis et audit npm sans vulnérabilité. Ces contrôles valident
le socle et les documents, pas la remplaçabilité effective des futurs modules.

Étape feuille de route : workflow E1–E6 validé avec Archify, 9 contrôles showcase
réussis, 0 erreur et 0 avertissement. Contenance vérifiée aux quatre tailles
desktop ; capture sombre 2048×1320 inspectée par l'agent. Reçu automatique
`visualReview: pending` ; interface fixe en anglais, contenu en français.
Source SHA-256 `9a4669b4fd030b89e23ff46584edc5baf8ededaa0197042905d103abf6c69f0c`
(1893 octets), HTML SHA-256
`aa2e971f621a592982160918710d2a7adc9168e0600ce6084b00461fc25cd949`
(706958 octets), artefact `dist/architecture/product-roadmap.workflow.html`.

Une première vérification a détecté le refus de workflow v2 par validate-docs.
Correction limitée à l'enveloppe de version, couverte par 14 tests ciblés réussis.
Audit blueprint : conforme, aucun nouveau module/dépendance runtime ; allowlist
et fermeture transitive vérifiées par `npm run blueprint:review`. Progress absent
du câblage et Stop fail-open selon ce contrôle. Requêtes, autorité des workers,
schémas de rapports et modes de coordination inchangés dans le diff.
AGENTS.md, CLAUDE.md et .codex/hooks.json inchangés. Seul le validateur documentaire
est modifié parmi les hooks ; rollback documenté dans ADR-0036. Aucun code produit.
Vérification complète après correction : `npm run verify` réussi, 263 tests
(262 réussis, 1 ignoré, 0 échec), 3 tests d'intégration réussis, audit npm sans
vulnérabilité et génération des quatre schémas produit réussie. Ce résultat ne
valide ni un prototype ni la consommation sur un OS cible.

Étape matrice OS : schéma runtime livré avec Archify, 9 contrôles showcase
réussis, aucune erreur ni avertissement. Contrôle de débordement réussi aux
quatre tailles desktop ; capture sombre 2048×1320 inspectée par l'agent.
Le reçu automatique conserve `visualReview: pending` (pas de validation humaine).
Interface fixe du visualiseur en anglais, contenu produit en français.
Reçu de livraison : source SHA-256
`f19f2da4b7f4a1fb50989740b561c099bf14702be4380531346e98464a92a0cb`
(1795 octets), HTML SHA-256
`df10dd3c62c09b1a41f69a7778c1333593074aaee8738d474fef611057eee663`
(706140 octets). Artefact local :
`dist/architecture/runtime-infrastructure.architecture.html`.
`npm run verify` réussi : 262 tests du socle (261 réussis, 1 ignoré, 0 échec),
3 tests d'intégration réussis et audit npm sans vulnérabilité. Aucun test desktop
produit exécuté. AGENTS.md, CLAUDE.md, configuration et hooks inchangés.

Recadrage thèmes/IA : schéma de préparation actualisé, livré avec Archify,
`npm run verify` réussi : 261 tests réussis, un ignoré, aucun échec ; trois
tests d'intégration réussis et audit npm sans vulnérabilité signalée.
Ces contrôles vérifient le dépôt ; aucun runtime ni assistant IA produit testé.
Le statut reste `template`, sans dépendance produit ni modification des hooks.
Validation du schéma :
9/9 contrôles showcase réussis, zéro erreur/avertissement. Contenance validée
aux quatre tailles desktop ; capture sombre 2048×1320 inspectée par l'agent.
Revue humaine du reçu `pending`, interface fixe du visualiseur en anglais.
Artefact : `dist/architecture/game-transformation.architecture.html`.
SHA-256 source : `7dedaf23ac97af4b8c843b6da0d40fc7513342ab1518d02857532786f7677636`.
SHA-256 HTML : `5857b34a999c8dd5af767bfa9c99cd3b03c9be92ea95316b016e9690bc61592b`.
Les empreintes suivantes décrivent les versions antérieures, pas cet artefact.

Étude infrastructure/consoles : troisième schéma produit livré et validé par
Archify (architecture, 9/9 contrôles showcase, zéro erreur/avertissement).
`npm run verify` réussi : 261 tests réussis, un ignoré, aucun échec ; trois
tests d'intégration réussis, audit npm sans vulnérabilité signalée. Le registre
déclare les trois schémas produit ; le statut demeure `template` et les hooks
sont inchangés. Ces résultats vérifient le dépôt, pas le produit envisagé.
Contenance vérifiée à 1440×900, 1600×1000, 1920×1080 et 2048×1320 ; capture
sombre 2048×1320 inspectée par l'agent, revue humaine du reçu `pending`.
Artefact : `dist/architecture/runtime-infrastructure.architecture.html`.
SHA-256 source : `81ec3ca438081182efc3c5e9690a7c6ae47b587ba6fee1fa330c4dd417c54129`.
SHA-256 HTML : `16682c09692b10393c6e6eb525511e033724d91e77d1c886511255b6b8b78c6f`.

Mise à jour distribution locale : `npm run verify` terminé avec succès
pour cette mise à jour documentaire (261 tests réussis, un ignoré, aucun échec ;
trois tests d'intégration réussis ; audit npm sans vulnérabilité signalée).
Le projet conserve le statut `template` ; aucun code produit ni hook modifié.
Schéma `game-transformation` livré avec Archify, neuf contrôles showcase
réussis, zéro erreur et zéro avertissement.
Le contrôle de débordement réussit aux quatre tailles desktop ; capture sombre
2048×1320 inspectée par l'agent. La revue humaine du reçu reste `pending`.
Libellés français, interface fixe du visualiseur en anglais (repli Archify).
Artefact : `dist/architecture/game-transformation.architecture.html`.
SHA-256 source : `ad26e413b6b44a6915e151086814213f5b400d6907c507b5177085987b23f8f6`.
SHA-256 HTML : `c8f4ad274b7a4aebeece6e3807e7f8581cca13d94933161d4ed9f385c48b955d`.

Les preuves ci-dessous concernent la validation antérieure du socle et de la
vue produit ; elles ne sont pas des tests du futur runtime.

Le second passage de `npm run verify` a terminé avec succès : validation,
tests du template, smoke CRG, intégration MCP, audit npm et génération HTML.
La suite rapporte 262 tests, 261 réussis, aucun échec ; couverture globale
91,10 % lignes, 75,55 % branches et 88,88 % fonctions. L'intégration rapporte
trois tests réussis. L'audit npm ne signale aucune vulnérabilité.
La configuration conserve bien `status: template` après ces contrôles.

Le schéma conceptuel possède une validation showcase Archify à neuf contrôles,
sans erreur ni avertissement de composition. Sa livraison HTML a réussi.
Le contrôle visuel automatique a réussi à 1440×900, 1600×1000, 1920×1080 et
2048×1320, sans débordement. Les captures claire à 1440×900 et sombre à
2048×1320 ont également été inspectées par l'agent. Le reçu automatique conserve
`visualReview: pending` pour une éventuelle revue humaine.

Artefact : `dist/architecture/product-vision.architecture.html`.
Empreinte SHA-256 source :
`922834c6c73b156e66edb8bc7070f79563845b1ef371c41eae6edc435c072b5e`.
Empreinte SHA-256 HTML :
`c5e6d3fb1285fdb59c76827c60cc66cc03c4783e9c73d3d7088abce0877a81a0`.

Le premier passage de `npm run verify` après rédaction a révélé que le test
d'initialisation pouvait interpréter les décisions rédigées comme complètes et
modifier le statut local. Le statut a été rétabli à `template`, et les champs
de décisions encore ouvertes utilisent désormais les marqueurs entre crochets
reconnus par le validateur amont. Conserver ces marqueurs jusqu'aux décisions
techniques évite une initialisation prématurée ; aucun hook n'a été modifié.

## Ce qui n'est pas réalisé

Aucun terminal, moteur graphique, extracteur, ROM importée ou intégration OS.
Aucun benchmark produit et aucune preuve d'exécution sur Linux ou Windows.
Aucune API ou format `.scene` adopté. Aucune stack produit sélectionnée.
La [recherche archivée](research/initial-research.md) est une synthèse explicitement
non verbatim du texte initial ; ses chiffres et références restent à vérifier.

## Prochaine conversation

Instruction de reprise actuelle : préparer E1 de docs/03-product-roadmap.md.
Identifier matériel/OS, budgets et décisions initiales ; première preuve E2 =
wallpaper synthétique sans ROM ni IA, avant terminal custom. Satisfaire les règles
d'initialisation avant code produit. Les prompts suivants sont historiques et
ne doivent pas rétablir l'ancien ordre ou rendre OoT obligatoire.

Priorité actuelle : comparer les solutions existantes pour créer, installer et
activer un package de thème wallpaper/terminal, puis choisir langages, composants
et preuves minimales. La préparation IA à la demande est une capacité séparée,
pas un service à maintenir dans la boucle d'affichage. Les propositions de banc
d'essai ci-dessous restent des possibilités et non un ordre déjà adopté.

Prochaine étape demandée : travailler sur l'architecture et l'infrastructure,
en comparant l'existant avec les frontières maintenant documentées. La discussion
peut commencer sans ROM ; ne pas adopter une stack à partir des seuls exemples.
L'étude documentaire est désormais disponible. La prochaine preuve proposée
est terminal + surface synthétique : choisir l'environnement hôte et le matériel,
puis tester l'ancrage et la consommation avant de verrouiller les composants.
La preuve d'ingestion à préparer reste l'extraction OoT décrite dans
[la transformation du jeu](architecture/game-transformation.md). Aucune ROM
`.z64`, `.n64`, `.v64` ni image `.iso`/`.gcm` n'a été trouvée dans le dossier
du projet lors de cette mise à jour. Identifier l'entrée et sa version avant
d'exécuter l'extraction. Comparer ensuite terminal, bureau et intégration à
partir des capacités démontrées ; les formats et la stack restent ouverts.

Prompt de reprise possible :

> Lis docs/session-handoff.md et le brief produit. Nous allons choisir les
> technologies et l'infrastructure en réutilisant au maximum l'existant.
> Compare d'abord les bases possibles pour un terminal et un bureau ludiques
> modulaires sur Linux, macOS et Windows. Ne considère pas la stack de la
> recherche initiale comme déjà décidée.

Précision au prompt :

> Commence par ADR-0034. Le produit est le package de thème, pas un catalogue de
> consoles. L'IA peut découvrir et préparer les outils à la demande, avec validation
> locale et dépendances séparées. Compare la stack sans privilégier automatiquement
> Rust/Tauri/Godot ; ne lance pas de conversion ni d'installation pour cette discussion.

Prompt complémentaire pour poursuivre la réflexion :

> Lis docs/architecture/game-transformation.md et ADR-0031. Prépare le PoC OoT
> avec les outils existants : identifier la ROM/version disponible et une scène,
> vérifier géométrie, matériaux, acteur animé, collision, audio et placements
> traçables. Conserver les données canoniques et qualifier les capacités manquantes.
> Ne fixe pas la stack avant ces preuves. La composition par code et le diorama
> ambiant économe sont déjà décidés ; la couverture globale progresse par scène.
