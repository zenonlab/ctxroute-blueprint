# PoC macOS 2 — connecteur natif maintenable

État au 8 septembre 2026 : **première tranche implémentée, qualification OS restante**.
Code et commandes : [connecteur isolé](../../pocs/macos-connector/README.md).
Périmètre livré : [ADR-0052](../decisions/ADR-0052-macos-poc2-implementation.md).
Entrée : PoC1 gelé et [architecture des connecteurs](../architecture/platform-connectors.md).
Ce PoC ne qualifie ni l'App Store, ni une API publique Apple de wallpaper dynamique.

## But

Prouver qu'une application connecteur macOS peut activer un thème portable, alimenter
un wallpaper natif, exposer une seule surface de contrôle et dégrader proprement les
interactions non sûres. Le travail repart d'un périmètre propre ; il ne transforme pas
la sonde accumulée en produit par renommage.

## Livrable borné

Le livrable contient :

- `ThemeFixture`: un manifeste canonique original, sans asset de jeu ;
- `ThemeModel`: validation et état déterministe sans type AppKit ;
- `MacConnectorApp`: installation, activation, permissions, diagnostic et réglages ;
- `MacWallpaperAdapter`: rendu du décor et des objets dans la surface gérée par macOS ;
- `MacInputAdapter`: capacité séparée, désactivable, qui refuse les clics ambigus ;
- `ConnectorProtocol`: commandes, quittances, versions et erreurs typées ;
- un harnais de qualification reproductible.

Il n'inclut ni terminal custom, ni ROM, ni IA, ni convertisseur, ni multi-OS, ni
préférence Finder privée dans le parcours principal.

Les contrôles visuels de ce PoC sont volontairement diagnostiques. Ils ne choisissent
ni le design system, ni le renderer, ni l'apparence des thèmes. Le manifeste prépare
des identités et slots compatibles avec [D1](theme-design-poc.md), sans implémenter
l'import 3D ou le rig dans le connecteur.

## Stack expérimentale

| Couche | Choix PoC2 | Motif | Décision de production ? |
| --- | --- | --- | --- |
| App connecteur | Swift 6 + AppKit | intégration native, TCC, packaging et cycle de vie macOS | non |
| Adaptateur wallpaper | Swift/Objective-C + Core Animation | chemin déjà observé dans WallpaperAgent | non, API privée à qualifier |
| Modèle de thème | JSON Schema + types Swift purs | manifeste unique et tests sans surface | format à stabiliser |
| Rendu de fixture | Core Animation | preuve minimale sans introduire un moteur général | non |
| Communication | fichiers atomiques App Group + signal Darwin sans payload | transport expérimental borné avec quittances corrélées | non |
| Tests | XCTest + scripts de package/runtime + gestes manuels | couvre logique, identité et comportement OS réel | oui comme stratégie locale |

Le PoC2 n'introduit pas wgpu, Tauri, terminal natif ou FFI Rust. Ces choix seraient
sans rapport avec la question testée et rendraient le résultat illisible.

## Flux attendu

1. L'application charge et valide le manifeste canonique.
2. Elle interroge les capacités réelles du connecteur et présente leur état.
3. L'adaptateur wallpaper reçoit une projection immuable de la scène.
4. Le wallpaper dessine le décor, les objets et, si choisi, le panneau logique.
5. L'entrée produit une intention par identité, jamais une commande AppKit arbitraire.
6. Le cœur applique la transition, puis le renderer et l'app observent le même état.
7. Toute perte de permission désactive `Input` sans arrêter l'animation ni recréer la
   scène.

## Règle du panneau unique

La fixture contient un seul `panel_id`. Pour la tranche initiale, le panneau interactif
est présenté dans l'application connecteur ; le wallpaper ne dessine qu'un indicateur
de sélection non interactif. Une variante ultérieure peut déplacer la présentation
dans la scène seulement après qualification du routage de clic. Les deux variantes ne
sont jamais actives ensemble.

Les contrôles système — permissions, sélection du provider, diagnostic et arrêt —
restent dans l'app connecteur. Les boutons du thème — animation, effet, session —
restent dans le panneau logique. Cette distinction empêche de confondre UI produit et
décor.

## Données et identité

Le manifeste est la seule source éditée. Les projections nécessaires à l'app et à
l'extension sont générées au build ou décodées par un module partagé ; elles ne sont
jamais maintenues manuellement en parallèle.

Chaque commande porte `schema_version`, `theme_id`, `scene_instance_id`, `command_id`
et `generation`. Une quittance tardive d'une ancienne génération est ignorée. Les
messages ont une taille bornée, aucune URL de fichier libre et aucune commande shell.

L'état durable minimal contient le thème choisi et des préférences non sensibles. Les
permissions TCC ne sont ni copiées ni contournées. Les caches sont reconstructibles.
Dans la première tranche, le thème est embarqué et l'état est uniquement en mémoire :
la persistance des préférences ci-dessus reste à implémenter.

## Politique d'entrée

Le mode par défaut est passif. La capacité interactive devient disponible seulement
si toutes les conditions sont vraies : permission obtenue, tap actif, bureau visible,
cible supérieure classifiée comme fond Finder autorisé, ancre actuelle confirmée et
génération de scène identique.

Une icône, une fenêtre, une cible Accessibility inconnue, une erreur AX ou l'absence
de permission produit un refus ouvert : l'événement original continue et aucune action
de thème n'est exécutée. Le PoC2 doit tester une icône native superposée ; un clic
programmatique sur un bouton AppKit ne suffit pas.

## Politique énergétique

Le renderer réagit aux changements d'état. Aucun timer n'est créé pour une scène
statique. Une scène animée annonce sa fréquence maximale et se suspend sur sommeil,
session inactive ou surface non présentée lorsque ce signal est fiable.

Les mesures rapportent l'énergie incrémentale par rapport au bureau natif, avec au
moins cinq passes après préchauffage. Les compteurs de frames et le CPU ne remplacent
pas les Joules et Watts. Le coût du connecteur, de WallpaperAgent et de tout helper est
compté ensemble.

## Critères d'acceptation

| ID | Preuve | Résultat requis |
| --- | --- | --- |
| M2-01 | Manifeste | une source canonique ; app et wallpaper produisent les mêmes identités et paramètres |
| M2-02 | Présentation | un seul panneau logique visible et actionnable |
| M2-03 | Cycle natif | activation, changement de Space, veille/reprise et redémarrage Finder sans second décor |
| M2-04 | Entrée sûre | icône Finder superposée prioritaire ; zone dégagée actionnable ou explicitement refusée |
| M2-05 | TCC | refus, octroi, révocation et reprise donnent un état exact sans polling |
| M2-06 | Cohérence | commandes idempotentes, quittances corrélées, messages périmés ignorés |
| M2-07 | Énergie | baseline et delta mesurés pour statique, animé, masqué et app connecteur fermée |
| M2-08 | Packaging | identités stables, signature reproductible, installation et désinstallation documentées sans suppression automatique |
| M2-09 | Défaillance | app absente : wallpaper reste sûr ; extension absente : app explique la capacité manquante |
| M2-10 | Revue visuelle | aucun plan visible devant Finder, aucune duplication de panneau, aucune disparition non expliquée |
| M2-11 | Réglage bureau | visibilité Finder lue, demandée et confirmée ; refus/timeout/redémarrage ne deviennent pas succès ; récupération native disponible |

## Conditions de sortie

### Correctifs de revue — état courant

Le modèle conserve la dernière quittance 30 secondes ; les publications sans action
ne l'effacent plus. Les mailboxes de test ont des notifications inactives par défaut.
Le préflight refuse les compagnons historiques, les providers historiques et les
providers PoC2 d'un autre paquet ; l'installation refuse aussi un provider PoC2 actif.
Aucun processus n'est arrêté implicitement. Les builds ad hoc annoncent explicitement
le transport indisponible avant accès au groupe ; ils ne demandent pas de changer de
fond pour résoudre une erreur de signature. Le contrôle natif M2-06 reste à qualifier.
Le manifeste accepte un sous-ensemble ordonné de contrôles, sans accorder leurs
capacités. Les fixtures préparent seulement audio et fichiers en haut à gauche.
La politique pure des gestes D1-14–16 est implémentée dans `GestureRouter` :
elle produit seulement des intentions, après relâchement confirmé. Huit tests
couvrent distinction gauche/droite, vide connu, priorité native, contrôles,
glisser annulé, permission perdue, scène remplacée et événements incohérents.
Le seuil de glisser est exprimé en points logiques locaux (4 par défaut), pas
en pixels globaux. Un geste capturé puis annulé conserve son relâchement associé
pour éviter de transmettre un événement orphelin. Le connecteur doit requalifier
la cible et l'autorisation aux deux extrémités ; `unknown` ne vaut jamais `empty`.
Le routage n'est pas branché au provider : aucun tap, lancement d'app, éditeur,
audio ou réglage Finder n'est activé par ces tests. M2-04/05 et D1 natif restent
non qualifiés. Le total courant est 17 XCTest, sans notifications système de test.
Cette implémentation reste dans le modèle existant : aucun contrat de transport,
dépendance ou frontière ne change. Le dataflow de personnalisation précise seulement
que la composition du thème possède aussi la politique de gestes.
Les tableaux datés ci-dessous sont historiques, pas un verdict courant de livraison.

### Preuves de la première tranche — 8 septembre 2026

| Critère | État réellement démontré |
| --- | --- |
| M2-01 | 4 objets/identités testés ; manifeste identique vérifié par `cmp` dans les bundles |
| M2-02 | smoke : une fenêtre ; inspection macOS réelle : libellés lisibles et boutons indisponibles sans provider ; aucun panneau dans le renderer |
| M2-03 | réacquisition et suspension implémentées ; Spaces/veille/Finder non qualifiés |
| M2-04 | entrée refusée structurellement : aucun tap, aucune fenêtre de décor |
| M2-05 | TCC non sollicité ; capacité interactive indisponible, cycle de permissions non testé |
| M2-06 | XCTest : dédoublonnage, conflit d'ID, expiration, génération et instance ; échange avec WallpaperAgent restant |
| M2-07 | aucune mesure énergétique ; pas de promesse de consommation |
| M2-08 | compilation Swift 6 sans avertissement, signature stricte, plists et manifeste vérifiés ; installation documentée, non exécutée |
| M2-09 | refus/timeout prévu dans l'app ; autonomie réelle du provider à observer après sélection |
| M2-10 | capture du panneau et vignette séparées de la revue du vrai bureau, encore requise |
| M2-11 | repli vers Réglages macOS ; toggle Finder indisponible, critère de lecture/confirmation non satisfait |

### Correctif du catalogue et tranche multithème — 8 septembre, 15:00

Le catalogue initial échouait dans le vrai décodeur Apple : `sortID` et
`shouldHideItemLabels` absents. Corrigé et couvert par `test-native.sh`, maintenant
appelé par le build. Les trois entrées Orbite, Lagon, Ambre statique ont été observées
dans Réglages Système > Fond d'écran > Wallpaper Connector — PoC 2.
Le build 3 est installé dans `~/Applications/Wallpaper Themes/Wallpaper Connector PoC 2.app`.
L'ancienne installation est conservée dans `dist/pocs/macos-connector/replaced.9w0TMf/previous-app.disabled`.
Le provider précédent a été redémarré seul ; aucun service Apple n'a été arrêté.

Orbite était sélectionné dans la session pendant la vérification. Le nouveau provider
a été lancé par WallpaperAgent et a créé deux CAContext natifs. Cela prouve acquisition
et catalogue, pas encore animation, absence de flash ou changement entre les trois scènes.
Cinq XCTest passent, dont catalogue et indépendance des états par thème.

Blocage M2-06 réel : `containermanagerd` rejette le groupe protégé sans Team ID valide ;
la sandbox journalise `deny file-write-create .../Connector-v1/status.json`.
L'app ne reçoit donc aucune quittance. Aucune suppression de sandbox, nouvelle
permission ou signature fictive n'a été appliquée. Le choix d'une identité de signature
appropriée ou d'un autre transport doit être résolu avant de qualifier les boutons.

Les cinq tests XCTest ne constituent pas onze critères validés. La tranche livrée
permet de commencer la qualification, elle ne clôt pas M2. Le provider repose sur
les interfaces privées Apple héritées d'une révision épinglée de Phosphene ; aucune
garantie publique Apple n'est ajoutée par le découpage du code.

Le PoC2 est réussi si M2-01 à M2-11 possèdent chacun une preuve datée et si les limites
de l'API wallpaper sont explicitement publiées. Un test automatisé ne remplace pas les
gestes Finder, Spaces et Mission Control.

Il est à reprendre si le rendu natif fonctionne mais que panneau, permissions ou état
sont dupliqués. Il échoue pour la cible interactive si la priorité Finder ne peut pas
être garantie ; dans ce cas le même connecteur reste valable en mode passif et
l'interaction bascule vers l'app ou un mode modal.

## Ordre d'implémentation

1. extraire le manifeste canonique et ses tests purs dans un nouveau répertoire ;
2. créer l'app connecteur avec état de capacités, sans wallpaper ;
3. créer l'adaptateur wallpaper à partir d'une projection du même manifeste ;
4. établir le transport corrélé et les reprises de cycle de vie ;
5. ajouter l'entrée en refus par défaut puis conduire les gestes natifs ;
6. mesurer l'énergie et produire le verdict avant toute intégration du terminal.

Après l'étape 1, D1 peut utiliser le schéma et ses fixtures indépendamment de la
surface macOS. Le raccord au wallpaper attend que les deux côtés passent leurs gates.

La première implémentation s'arrête après M2-03 si une duplication visuelle réapparaît :
elle corrige la frontière avant d'ajouter l'entrée.
