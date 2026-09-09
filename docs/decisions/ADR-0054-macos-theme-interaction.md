---
scope:
  - .project/project-config.json
  - docs/00-project-brief.md
  - pocs/macos-connector/**
  - docs/architecture/platform-connectors.md
  - docs/architecture/src/platform-connectors.architecture.json
  - docs/architecture/theme-customization.md
  - docs/session-handoff.md
review: on-change
revised: true
---
# ADR-0054 — Gestes, modale et personnalisation locale du PoC2

- Status: accepted
- Date: 2026-09-08

## Context

Le canal XPC est qualifié, mais aucune entrée de bureau ni édition n'était raccordée.
Le panneau de diagnostic ne constitue pas une UI de thème. Le clic droit demandé
ouvre une modale de personnalisation, jamais un panneau placé à droite de l'écran.

## Decision

Le provider conserve le rendu natif et peint les deux contrôles dans son arbre de
calques. Il publie la géométrie et l'horloge de chaque surface pour un hit-test CPU
partageant exactement la construction des trajectoires. Aucun polling de rendu.
Une seule voie d'entrée traite contrôles fixes, objets mobiles et clic droit vide :
un `CGEventTap` actif sur un thread et une CFRunLoop dédiés. L'agent demande d'abord
le point HID utilisé par les implémentations Tahoe observées, puis se replie sur le
point de session officiellement disponible si macOS refuse HID au processus non-root.
Le point réellement acquis est publié dans le diagnostic. Le tap annoté plus tardif
n'isole pas suffisamment le contrôle du geste système. Un watchdog vérifie l'état réel du port et le réarme si
macOS le désactive silencieusement. L'agent ne crée aucune
fenêtre AppKit proxy tant que Finder expose son plan de bureau. Le tap supprime uniquement l'appui, le drag éventuel et le
relâchement d'un geste dont la surface, la cible et le fond Finder sont qualifiés.
Une erreur, une ambiguïté ou une cible native laisse l'événement original à macOS.
Dans ce PoC, les objets simples conservent la zone invisible éprouvée par le PoC1
(minimum 112×70 points) et la cible la plus proche gagne en cas de recouvrement.
Cette zone n'est pas un `CALayer` interactif. Le contrat de
scène de production devra fournir des formes d'interaction explicites adaptées aux
sprites, maillages 3D, boutons et collisions importés.
L'agent reçoit seulement les gestes autorisés : une icône, une fenêtre ou une cible
AX inconnue garde la priorité. Un glisser n'est jamais converti en clic.
Quand les éléments du bureau sont visibles, le fond Finder est qualifié par l'élément
AX directement pointé et son ascendance, pas par une énumération de tous les enfants
du bureau. La cible doit être un groupe ou une zone de défilement Finder, atteindre
l'application Finder, contenir une zone de défilement et ne traverser aucune fenêtre.
Les rôles natifs d'icône, libellé et bouton sont refusés dès le premier élément.
Quand `CreateDesktop=false` retire ce plan AX, ni AX ni `CGWindowList` ne décrivent
fidèlement l'exposition visuelle produite par Afficher le bureau : les fenêtres
d'applications restent déclarées aux anciennes coordonnées. Le tap global refuse donc
tous les gestes dans cet état. Le connecteur matérialise uniquement les cibles du
thème par de petites `NSPanel` transparentes au niveau `normal - 1`, derrière les
applications ordinaires, sans aucun pixel. Elles sont détruites dès le retour de
Finder. Une icône Finder garde ainsi la priorité lorsqu'elle existe et une application
non déplacée reste au-dessus. Le clic droit du vide n'est pas offert dans ce mode :
une fenêtre plein écran transparente compromettrait les interactions natives.

Clic gauche sur objet : application associée. Clic droit sur objet : modale unique
préremplie. Clic droit sur vide qualifié : même modale en ajout. L'édition est un
brouillon ; Annuler ne mute rien, Enregistrer valide, envoie une commande corrélée,
puis conserve la configuration locale. Aucun shell ni commande arbitraire.

Les personnalisations sont dans Application Support, séparées des fixtures signées.
Les associations d'applications sont locales et proviennent d'un choix utilisateur.
Le mute porte uniquement sur l'audio du thème, jamais le volume système. Le contrôle
Finder reste conditionné par une capacité OS observée. Son icône ne présente que
l'état relu par l'agent : écran si inconnu, œil si visible, œil barré si masqué.
Cet état de préférence ne prouve pas à lui seul le résultat visuel du compositeur.
Un chemin de récupération natif reste disponible hors de la scène.

## Consequences

Le contrat XPC ajoute des configurations validées et des instantanés géométriques
bornés. Les types Apple ne sortent pas du connecteur. L'accès global aux événements
reste soumis à TCC, jamais accordé automatiquement. La revue réelle doit couvrir
icône superposée, glisser, changement de Space, annulation de modale et reconnexion.
Cette tranche n'est pas un importeur 3D/ROM ni un terminal PTY complet. Le tap se
réarme après désactivation système, reconstruit son instantané lors des changements
d'applications, d'écrans, de Space et de session, et publie son état dans le
diagnostic. Le hit-test AX synchrone est borné mais demeure une limite du PoC à
mesurer avant production. Le callback ne réalise aucune commande XPC, ouverture
d'application ou mutation AppKit ; ces effets sont déportés sur le `MainActor`
après le relâchement.

## Limites de la preuve

Le [tap Core Graphics](https://developer.apple.com/documentation/coregraphics/cgevent/tapcreate(tap:place:options:eventsofinterest:callback:userinfo:))
ne remplace pas l'autorisation système. Aucun consentement TCC n'est accordé par
le code ou déduit de la signature ad hoc. Le classifier Finder est un candidat
structurel conservateur, pas une garantie publique Apple ; les tests réels restent
requis, en particulier avec une icône exactement superposée à une ancre. Une surface
sans écran associé ou ambiguë échoue ouverte vers macOS.
Les fixtures n'ont pas de piste audio ; mute est un état du thème. L'essai installé
sur MAC-01 a prouvé que `StandardHideDesktopIcons` pouvait être relu et provoquer un
rechargement de Finder sans masquer les éléments. Ce signal est donc abandonné.
Le contrôle Fichiers utilise l'adaptateur réversible `com.apple.finder/CreateDesktop`
déjà observé dans le PoC1. Il n'écrit qu'après un geste utilisateur, confirme la
valeur, puis redémarre le seul service Finder de la session ; il ne touche ni à Dock
ni aux fichiers. Une cible déjà dans l'état demandé n'entraîne aucun redémarrage.
Après échec du rafraîchissement, l'agent tente un rollback confirmé ; son échec est
distinct et n'est jamais acquitté. Trois actions XPC bornées projettent visible,
masqué ou inconnu dans le provider. Le menu natif conserve un réaffichage explicite
indépendant du wallpaper. Cette préférence reste privée et qualifiée par version :
le cycle visuel complet et les clics après masquage doivent être éprouvés sur le
paquet signé exact. Le premier essai `CGWindowList` est invalidé sur MAC-01 : Chrome
restait retourné au point après Afficher le bureau et bloquait toute interaction.
