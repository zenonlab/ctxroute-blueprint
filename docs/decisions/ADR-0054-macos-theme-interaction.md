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
Les contrôles système fixes sont toutefois possédés en entrée par de petites fenêtres
AppKit transparentes de la taille exacte de leur hit-box. Elles ne dessinent aucun
pixel, ne couvrent jamais l'écran entier, restent sous les applications normales et
appellent directement l'intention du contrôle. Le tap global exclut ces rectangles :
un même geste ne peut donc atteindre à la fois le contrôle et le fond Finder.
Cette exception ne s'étend pas aux objets mobiles, qui restent calculés par le tap.
Dans ce PoC, les objets simples conservent le proxy invisible éprouvé par le PoC1
(minimum 112×70 points) et la cible la plus proche gagne en cas de recouvrement.
Le proxy n'est pas un `CALayer` interactif ni une fenêtre superposée. Le contrat de
scène de production devra fournir des formes d'interaction explicites adaptées aux
sprites, maillages 3D, boutons et collisions importés.
L'agent reçoit seulement les gestes autorisés : une icône, une fenêtre ou une cible
AX inconnue garde la priorité. Un glisser n'est jamais converti en clic.
Le fond Finder est qualifié par l'élément AX directement pointé et son ascendance,
pas par une énumération de tous les enfants du bureau. La cible doit être un groupe
ou une zone de défilement Finder, atteindre l'application Finder, contenir une zone
de défilement et ne traverser aucune fenêtre. Les rôles natifs d'icône, libellé et
bouton sont refusés dès le premier élément. Cette politique reste fermée en cas
d'erreur ou de chaîne inconnue et évite un coût variable avec le nombre d'icônes.
Une icône Finder placée dans la hit-box d'un contrôle fixe n'est pas qualifiée dans
ce PoC : la zone du contrôle est réservée par le thème. Le connecteur doit annoncer
cette restriction au lieu de revendiquer une priorité Finder universelle.

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
Cette tranche n'est pas un importeur 3D/ROM ni un terminal PTY complet.

## Limites de la preuve

Le [tap Core Graphics](https://developer.apple.com/documentation/coregraphics/cgevent/tapcreate(tap:place:options:eventsofinterest:callback:userinfo:))
ne remplace pas l'autorisation système. Aucun consentement TCC n'est accordé par
le code ou déduit de la signature ad hoc. Le classifier Finder est un candidat
structurel conservateur, pas une garantie publique Apple ; les tests réels restent
requis, en particulier avec une icône exactement superposée à une ancre. Une surface
sans écran associé ou ambiguë échoue ouverte vers macOS.
Les fixtures n'ont pas de piste audio ; mute est un état du thème. Le contrôle
Fichiers appelle désormais un contrôleur local de `StandardHideDesktopIcons`
(WindowManager), sans modifier `CreateDesktop`. Après confirmation de l'écriture,
l'agent redémarre le seul service Finder de la session pour appliquer la présentation,
comme le PoC1, sans redémarrer Dock ni toucher aux fichiers. L'action OS
reste la propriété exclusive de l'agent. Trois actions XPC bornées projettent ensuite
visible, masqué ou inconnu dans l'état visuel du provider ; elles ne modifient aucun
réglage. La préférence est relue à chaque action ; un échec d'écriture, de
confirmation ou de rafraîchissement est signalé. Après échec du rafraîchissement,
l'agent tente un rollback confirmé ; son échec est distinct et n'est jamais acquitté.
Le menu natif conserve
un réaffichage explicite indépendant de la capture des clics. Stage Manager actif
ou bureau Finder désactivé par un autre outil : refus, avec accès aux Réglages.
La case native a suivi l'écriture sur MAC-01, mais le cycle visuel complet depuis
le bouton du nouveau paquet et les clics après masquage restent à qualifier.
