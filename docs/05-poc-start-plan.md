# Démarrage des PoCs — décisions expérimentales

État au 7 septembre 2026 : plan accepté pour expérimentation, aucun PoC exécuté.
Ce document ferme le périmètre de départ, pas le choix de production.
Il complète [E1–E6](03-product-roadmap.md) et le
[protocole de mesure](04-experimental-protocol.md), sans les remplacer.
Décision : [ADR-0042](decisions/ADR-0042-bounded-poc-start.md).

## Verdict corrigé

- L'architecture est une hypothèse testable, pas la meilleure solution démontrée.
- Extensible à des jeux inconnus ne signifie pas conversion universelle garantie.
- Une IA peut préparer des adaptations ; elle ne fournit ni preuve de fidélité,
  ni autorisation d'exécution, ni capacité absente du runtime.
- Notre contrôleur de formation remplace volontairement certains comportements
  compétitifs. Il ne prétend pas reproduire les bots originaux.
- Une bibliothèque native de terminal ne fournit pas nécessairement une UI complète.
  Un triangle wgpu ne prouve pas le chargement et l'interactivité d'un environnement.
- Zéro présentation ne signifie pas zéro consommation ; les catégories 2D/3D/vidéo
  ne constituent pas un classement énergétique.
- Une fenêtre interactive ne prouve pas un wallpaper interactif ; un résultat
  macOS ne qualifie ni Windows ni un compositeur Linux.

Les études historiques restent disponibles avec leurs dates et limites. Les
assertions contradictoires de la conversation ne deviennent pas des exigences.

## Stack expérimentale retenue

| Partie | Choix pour les essais | Limite de cette décision |
| --- | --- | --- |
| Sonde OS initiale | Swift + AppKit sur MAC-01, SDK local ; contrôles natifs | Programme de diagnostic jetable, pas adoption de Swift pour le produit portable |
| Contrôleur et rendu candidat | Rust, Cargo, wgpu/WGSL, winit ; dépendances ajoutées au moment du PoC concerné | Pas de moteur 3D généraliste à construire ; aucune version distante adoptée par défaut |
| État et fixtures | Structures typées et JSON versionné de test ; géométrie originale | Format interne expérimental, pas package public `.scene` figé |
| Tests | Tests unitaires Rust pour contrôleurs ; sonde native et gestes OS consignés ; banc B-R pour rendu | Tests blueprint conservés mais comptés séparément |
| Backend et transport | Aucun service distant ; sessions simulées en mémoire | IPC et PTY réels attendent E4 ; pas un démon par contrat |
| Stockage | Fixtures versionnées ; sorties reconstructibles sous `dist/` | Aucun stockage de ROM, terminal, capture du bureau ou secret dans ces essais |
| Déploiement | Compilation et lancement locaux explicites sur machine disponible | Aucun auto-start, installateur, changement du fond système ou publication |
| Observabilité | Compteurs dessin/ticks/événements, durées monotones et résultat JSON local borné | Pas de contenu PTY ; compteurs distincts des watts |
| Sécurité | Code de test relu et compilé ; aucune extension tierce chargée | Ni VM, shell command, téléchargement de jeu, LLM ni réseau à l'exécution |
| Performance | Attente sans animation, plafond animé 30 Hz initial ; pause manuelle | Profil de banc, non seuil de production ; 60 Hz étudié séparément |

La sonde native sert de référence indépendante : si AppKit échoue aussi, ne pas
attribuer l'échec à wgpu. Elle n'est pas reliée au contrôleur Rust par une nouvelle
FFI pour ce test. Les sources publiques et limites des candidats sont dans le
[préflight de stack](research/stack-preflight.md) ; revérifier versions, licence,
compatibilité et exemples avant de créer le lockfile de chaque prototype.
Ne pas installer Godot, Bevy, une VM ou deux terminaux pour commencer.

Références amont : [wgpu](https://github.com/gfx-rs/wgpu) fournit l'API graphique ;
[winit](https://github.com/rust-windowing/winit) fournit fenêtres et événements.
Leurs dépôts ont été reconsultés pour ce cadrage, pas compilés : aucun support
de fond d'écran ni avantage énergétique n'est déduit de leurs README.

## Trois livrables bornés

### L1 — Surface OS avant moteur

Sur MAC-01, créer une fenêtre ordinaire avec un bouton et un panneau natifs.
Exécuter séparément un mode desktop **passif**, sans capture globale ; sortie
automatique configurable et moyen d'arrêt accessible depuis le terminal lanceur.
Observer apparition, fermeture, redimensionnement, écran/Spaces et notifications
de visibilité. La visibilité inconnue reste inconnue ; pause manuelle disponible.
N'altérer ni les fichiers du bureau ni les réglages persistants du système.

L'interactivité derrière Finder est une seconde épreuve B-O01–B-O04, pas un acquis
du bouton en fenêtre normale. Les tests avec icônes superposées demandent un geste
utilisateur ou une fixture de bureau explicitement autorisée. Le mode passif ne
réussit pas B-O03. Un échec garde la capacité désactivée ; pas de repli modal imposé.

Sortie : code minimal, commande réelle de compilation/lancement, version SDK,
capacité observée par mode, gestes exécutés/non exécutés et limites. Pas de verdict
d'énergie fondé uniquement sur la sonde CoreGraphics ou les notifications AppKit.

### L2 — Contrôleur déterministe sans GPU

Un module Rust sans types wgpu/AppKit, horloge injectée, fixtures originales :
chemin 2D fermé et chemin XYZ avec virage, pente et branche explicitement choisie.
Une troisième fixture avec noms/champs différents passe par une traduction locale
vers les mêmes données ; cela teste la frontière custom, pas tous les moteurs.

Progression commune en distance, identité stable des places, orientation tangentielle,
formation et récupération vers la place mobile actuelle. Le transport remplace
temporairement l'autorité de formation. Aucun calcul de bots compétitifs nécessaire.
Le banc vérifie raccord, distances, orientation, ajout/retrait et trajet de retour.
Une enveloppe de route est une donnée de fixture connue ; un simple chemin central
ne prouve pas l'absence de collision. Tester voie trop étroite et repli interdit.

Tests de référence : mêmes entrées et temps → mêmes sorties dans la tolérance
annoncée ; pas de NaN/infini ; frames 30/60 Hz aux mêmes instants → même progression ;
état erreur conservé après récupération ; ID supprimé non ressuscité par événement
tardif ; pause sans progression ni rattrapage illimité à la reprise.

Sortie : tests A02–A04/A06/A08 partiels clairement nommés, aucun succès A01 universel.
Ni sprite original, ni Lakitu extrait : indicateur de récupération original.

### L3 — Rendu et interaction représentatifs

Brancher L2 à un petit hôte Rust/wgpu en fenêtre : image 2D, géométrie 3D originale,
transparence, picking et panneau/bouton pilotant animation/effet puis retour d'état.
Changer caméra et disposition, pas seulement lire une vidéo figée. Réutiliser
une brique UI après inspection de son exemple ; ne pas écrire un toolkit complet.
La sélection précise de cette brique fait partie de L3, pas un blocage de L1/L2.

Mesurer séparément contrôleur seul, scène statique, animée, mise en pause et surface
masquée lorsque son état est connu. Tester l'adaptateur desktop ensuite en reprenant
les épreuves de L1 ; ne pas extrapoler l'ancrage d'une fenêtre de technologie différente.
Toute comparaison avec vidéo ou un moteur existant fixe les fonctionnalités communes
et publie les différences. Un seul concurrent ciblé si un manque concret est constaté.

Sortie : résultats B-R/R01–R04/I01 applicables, coûts mesurés et travail restant.
L1 ou L2 réussi seul ne ferme pas E2 et ne choisit pas le moteur de production.

## Profil de données et sécurité initial

Les contrôleurs initiaux sont compilés dans le binaire de test. La fixture contient
uniquement des données : version `1`, identités, points, parcours choisi, paramètres
et états synthétiques. Aucun nom de fonction à évaluer, script, shader importé,
chemin absolu ou URL exécutable. Un type/version inconnu est rejeté.

Bornes initiales de sûreté du banc, à tester avant parsing/activation : 1 Mio par
fixture, 4096 points, 8 véhicules visibles, 256 événements en attente, profondeur
de données 16. IDs uniques ; coordonnées finies ; segments de longueur nulle et
trajectoires insuffisantes refusés. Dépassement → diagnostic et non-activation,
jamais troncature silencieuse. Ces limites ne sont pas celles du futur produit.

Événement simulé : `source_id`, `source_epoch`, `session_id`, `sequence`, `state`.
État parmi `active`, `waiting`, `error`, `finished`, `unknown`, `disconnected`.
L'hôte garde son heure monotone de réception ; pas de comparaison d'horloges de
machines. Même source/époque : séquences anciennes ou répétées rejetées. Changement
d'époque : snapshot complet requis ; déconnexion/information périmée → inconnu,
pas succès. Délai de fraîcheur configurable, fixé à 5 secondes dans la fixture.
Un silence PTY réel n'entre pas dans ce banc et n'est pas classé comme une panne.

Actions autorisées ici : ouvrir/fermer panneau, sélectionner un ID simulé, lancer
ou annuler une animation/effet local, pause/reprise. Aucune commande système ni
relance de travail. Changement de scène annule les intentions et contrôleurs de
sa révision. Une seule autorité écrit la transformation d'un véhicule par pas.
Avant tout code généré tiers : nouvel arbitrage isolation/quotas, essais hostiles
et autorisations ; Rust ou Wasm ne constitueront pas seuls une preuve de confinement.

## Mesure et critères de décision

MAC-01 est le seul banc relevé : voir sa [fiche](research/os-feasibility.md#premier-banc-observé--mac-01).
Relever de nouveau OS/SDK, résolution, fréquence effective, luminosité et alimentation
au lancement ; ne pas utiliser le maximum de fréquence déclaré comme fréquence réelle.
Windows/Linux, IME complet, multi-écrans et puissance matérielle restent non qualifiés.

Avant instruments énergétiques disponibles, L1/L2 peuvent produire des résultats
fonctionnels. Cela ne donne pas de verdict énergétique et ne ferme pas E2.
Les premières mesures établissent une baseline ; geler ensuite les budgets de
comparaison, avant de comparer les candidats, sans fabriquer un seuil en watts.
Conserver les cinq passes et conditions du protocole B-R pour cette comparaison.

Critères initiaux vérifiables : aucune action externe ; aucune intention sur icône
native ; aucune croissance non bornée ; zéro tick de simulation pendant pause ;
aucune soumission provoquée par le moteur pour une scène statique sans invalidation.
Une redemande OS reste journalisée séparément. Délais CPU, mémoire et énergie sont
mesurés, pas annoncés satisfaits à partir de ces critères fonctionnels.

Résultat par capacité : prévu, réussi, échoué, non applicable ou non concluant,
avec commande, révision, entrée/hash et données brutes. Un défaut corrige le PoC
concerné avant d'étendre sa portée. Aucun résultat factice dans un dossier de preuves.

## Passage à l'implémentation

Le dépôt est encore `template` : avant le premier code produit, terminer la lecture
des documents starter, reporter ces décisions expérimentales dans la configuration,
qualifier les commandes de build/test et lancer `npm run initialize` conformément
à ADR-0001. Ne pas modifier son statut manuellement ni annoncer cette étape faite.
Cette préparation administrative ne nécessite pas une nouvelle sélection de stack
de production ni une nouvelle approbation de principe.

Puis réaliser L1, L2, L3 dans cet ordre, avec un compte rendu par résultat cohérent.
La session suivante doit commencer par cette initialisation et L1, pas par une
nouvelle recherche générale de moteurs. Aucun PoC, benchmark ou support OS n'est
livré par la présente correction documentaire.
