---
scope:
  - pocs/macos-native-wallpaper/**
  - docs/pocs/macos-native-wallpaper.md
  - docs/architecture/src/macos-native-wallpaper.architecture.json
  - .project/project-config.json
review: on-change
revised: true
---
# ADR-0047 — Qualification isolée du wallpaper natif Apple

- Status: accepted
- Date: 2026-09-07

## Context

L'utilisateur refuse un fond implémenté comme fenêtre superposée. ADR-0043–0046
restent des expériences historiques, pas la solution demandée. Phosphene déclare
le point d'extension `com.apple.wallpaper` et implémente les échanges XPC privés
avec WallpaperAgent. Son ColorDiag fournit une animation Core Animation existante.

## Decision

Préparer un essai indépendant sous `pocs/macos-native-wallpaper/`, à partir de
Phosphene MIT révision `8b5bd57c1450eda74cf2ec6ceaae2e586cfdfcd6`.
Conserver l'amont intact et appliquer les adaptations de diagnostic uniquement
à une copie de build. Ne pas incorporer l'application hôte complète ni
ses outils de mise à jour au runtime du projet.

La préparation ne lance aucune extension, n'écrit pas dans son conteneur utilisateur,
ne change pas le fond système et ne redémarre aucun service Apple. Compiler et
inspecter un binaire ne prouve ni son admission par macOS, ni ses transitions.
La sélection réelle dans les réglages reste une étape de qualification distincte.
Ne pas présenter l'absence de certificat local comme preuve que toute signature
ad hoc serait impossible ; son admission n'est simplement pas établie.

## Consequences

Le framework et CAContext sont privés : cette voie ne garantit ni stabilité
inter-version ni distribution App Store. ColorDiag ne valide ni clics, ni panels,
ni glTF/Metal/wgpu. Aucun callback souris n'est défini dans le protocole XPC amont
inspecté ; aucune conclusion universelle d'impossibilité n'en découle.
Le build natif et sa validation sont séparés de la CI documentaire Node.
Un éventuel lancement exige revue du code exécuté, identité de bundle isolée,
signature admissible et procédure de retour au fond antérieur.

## Extension du test — paquet local

Après demande utilisateur de préparer un test, `prepare.sh --package` assemble
une application hôte AppKit minimale et son extension dans `Contents/Extensions`.
Identités `org.wallpaperthemes.nativeprobe` et `.extension`, signature ad hoc
locale vérifiée, sandbox activée pour l'extension sans droit réseau ajouté.
L'enregistrement explicite par `pluginkit -a` est autorisé pour cette qualification ;
il ne vaut pas sélection d'un fond ni admission effective par WallpaperAgent.
Le fond est sélectionné manuellement par l'utilisateur, qui revient à son ancien
fond dans Réglages pour arrêter l'essai. Pas de désactivation SIP/Gatekeeper.

Le build exclut VideoLibrary et SpiralRecovery amont, remplacés par une seule
entrée diagnostic en mémoire et des opérations inertes. Le patch de copie retire
l'ouverture de l'application amont et remplace les noms de notifications par
l'espace de nom propre. Les échecs d'identification des appelants XPC deviennent
des refus. Les échanges privés et leur rendu restent des hypothèses à tester.

Source : [Phosphene épinglé](https://github.com/kageroumado/phosphene/tree/8b5bd57c1450eda74cf2ec6ceaae2e586cfdfcd6).

## Commandes visuelles isolées — 8 septembre 2026

Après confirmation utilisateur de l'animation du build 3, conserver ce paquet
en cours. Le build interactif utilise une identité différente
`org.wallpaperthemes.nativeprobe.interactive` et `.extension` : sa compilation
ne remplace ni l'enregistrement ni le processus déjà qualifié.
Sa scène emploie aussi un UUID distinct du diagnostic animé précédent : les
descripteurs de choix de WallpaperAgent ne doivent jamais partager l'identité
de contenu entre deux fournisseurs.

Un compagnon AppKit expose sept commandes explicites : ouvrir/fermer un panneau
dans les calques du fond, pause/reprise, effet activé/désactivé et réinitialisation.
Le panneau de commande est une fenêtre ordinaire, pas une imitation de wallpaper.
Le panneau du décor est, lui, dessiné dans le contexte natif de l'extension.

La scène interactive est un asset versionné `interactive-theme.json`, validé à
la fois par `interactive-theme.schema.json` et par le décodeur Swift avant usage.
Il porte l'identité de scène, les couleurs, la durée du balayage, le panneau et
les sept actions avec leurs cadres normalisés. Trois ancres de décor distinctes
référencent ces actions sans les dupliquer. L'hôte et l'extension consomment
le même asset ; les contrôles visuels du décor ne sont donc pas codés deux fois.
Une erreur de manifeste échoue fermée : aucune entrée de scène ni commande n'est
exposée. Ces calques nommés préparent le futur hit-testing, mais ne revendiquent
encore aucune réception de clic par WallpaperAgent.

Le hit-tester pur traduit déjà les coordonnées écran vers les ancres et contrôles
du panneau. Son contrat refuse toute intention quand l'adaptateur OS signale du
contenu natif prioritaire à cet emplacement. Cette règle est testée sans installer
de moniteur global ; l'identification réelle des icônes Finder reste non prouvée.

Un premier adaptateur macOS en lecture seule prépare cette frontière sans
l'activer. Il vérifie d'abord `AXIsProcessTrusted()` sans afficher de demande,
puis peut interroger l'élément supérieur avec
[`AXUIElementCopyElementAtPosition`](https://developer.apple.com/documentation/applicationservices/1462077-axuielementcopyelementatposition).
Le classificateur n'autorise un clic wallpaper que pour une signature Finder
préalablement qualifiée et inscrite explicitement. La liste de production reste
vide : permission absente, échec AX, processus tiers, icône Finder ou signature
inconnue donnent tous priorité au contenu natif. Le module ne déclenche aucune
action AX et n'est pas encore relié à un moniteur d'événements.

L'inspection du [protocole XPC épinglé](https://github.com/kageroumado/phosphene/blob/8b5bd57c1450eda74cf2ec6ceaae2e586cfdfcd6/PhospheneExtension/WallpaperExtension-Bridging-Header.h)
confirme qu'il ne déclare que cycle de vie, réglages, choix, téléchargements et
notifications : aucune route de pointeur. La documentation Apple de
[`addGlobalMonitorForEvents`](https://developer.apple.com/documentation/appkit/nsevent/addglobalmonitorforevents%28matching%3Ahandler%3A%29)
garantit seulement une copie asynchrone des événements livrés aux autres applications,
sans possibilité de les modifier ou de les bloquer. Ce moniteur peut alimenter
un futur adaptateur, mais ne prouve pas à lui seul qu'un clic visait une icône Finder.
Le mode direct devra donc rester désactivé quand cette priorité ne peut pas être
établie ; aucune action en double n'est acceptable.

Pour ce seul diagnostic, réutiliser les notifications Darwin déjà employées
par l'amont : noms fixes sans charge utile et actions idempotentes, traitées
sur Lifecycle.queue. Canal non authentifié, sans accusé de réception ni garantie
de livraison : l'UI indique une demande envoyée, jamais une réussite supposée.
Interdiction d'y transporter des commandes système, chemins, sessions ou données
privées. Les références aux calques sont faibles ; aucun timer supplémentaire.
Ce transport n'est pas le contrat IPC du produit final.

Aucune observation souris/clavier globale ni permission Accessibilité activée.
Le clic direct sur le décor et la priorité Finder restent une expérience séparée,
soumise à accord utilisateur et preuve. Ne pas annoncer cette étape comme
l'intégration du terminal, des jeux, ou de toutes les interactions produit.
