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
L'agent reçoit seulement les gestes autorisés : une icône, une fenêtre ou une cible
AX inconnue garde la priorité. Un glisser n'est jamais converti en clic.

Clic gauche sur objet : application associée. Clic droit sur objet : modale unique
préremplie. Clic droit sur vide qualifié : même modale en ajout. L'édition est un
brouillon ; Annuler ne mute rien, Enregistrer valide, envoie une commande corrélée,
puis conserve la configuration locale. Aucun shell ni commande arbitraire.

Les personnalisations sont dans Application Support, séparées des fixtures signées.
Les associations d'applications sont locales et proviennent d'un choix utilisateur.
Le mute porte uniquement sur l'audio du thème, jamais le volume système. Le contrôle
Finder reste conditionné par une capacité OS observée ; un réglage de préférence
non confirmé visuellement n'est pas présenté comme une preuve de fichiers masqués.
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
requis. Une surface sans écran associé ou ambiguë échoue ouverte vers macOS.
Les fixtures n'ont pas de piste audio ; mute est un état du thème. Le contrôle
Fichiers ouvre les Réglages tant que le toggle OS n'est pas qualifié.
