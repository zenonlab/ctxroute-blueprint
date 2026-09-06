---
scope:
  - apps/extension/**
  - packages/application/**
  - packages/adapters-browser/**
  - packages/ui/**
  - docs/00-project-brief.md
  - docs/ui/**
  - docs/architecture/src/tobirink.architecture.json
  - docs/architecture/src/ui-system.architecture.json
review: on-change
revised: true
---

# ADR-0032 — Contexte actif et cache de reprise du popup

- Status: accepted
- Date: 2026-09-04
- Revised: 2026-09-06

## Contexte

Le popup doit reconnaître l’œuvre de l’onglet actif et rouvrir sa dernière URL
utile. Il doit aussi proposer quelques œuvres interrompues sans transformer le
menu en bibliothèque ni rendre cet historique indispensable aux données privées.

## Décision

Ajouter uniquement la permission `activeTab`. Après l’ouverture volontaire du
popup, l’adaptateur navigateur lit le titre et l’URL HTTP(S) de l’onglet actif.
Il ne demande aucune permission hôte et n’injecte aucun script dans la page.

Le même contexte peut porter une observation de progression uniquement lorsque
le titre ou l’URL contient un marqueur explicite de chapitre ou d’épisode. Le
cas d’usage parcourt au plus 500 `FavoriteSource`, suit leurs Review résolues et
n’accepte la corrélation que si elles convergent vers une seule `Work`. Il lit
alors l’unique progression de cette œuvre dans la même transaction IndexedDB.
Une progression absente est créée avec un identifiant déterministe. Une hausse
compatible est enregistrée; une égalité, une baisse, un type incompatible, un
dépassement du maximum connu, une ambiguïté ou une limite atteinte ne produit
aucune écriture.

Le cas d’usage applicatif normalise prudemment le titre, produit une vue
sérialisable de l’œuvre active et maintient au plus cinq reprises inachevées.
Une reprise conserve son identifiant normalisé, son titre, sa dernière URL,
son type, sa source, sa progression facultative et sa date de consultation.
Les entrées expirent après trente jours et une entrée marquée terminée est
retirée.

Le cache est stocké sous une clé locale versionnée par un adaptateur de
`packages/adapters-browser`. Il est non autoritaire, reconstructible et exclu
des exports et sauvegardes. Sa suppression, l’effacement des données de
l’extension ou une valeur invalide produisent simplement une liste vide.
IndexedDB reste l’unique autorité de la bibliothèque et de la progression.

Le composant `Popup` reçoit uniquement les modèles sérialisables et callbacks.
La carte « Cette œuvre » utilise la coque `WorkCard` en ratio paysage 3:2 ; les
cartes « Continuer mes œuvres » conservent le ratio portrait 2:3. L’onglet
Sorties reste distinct. Quand la corrélation locale réussit, la carte reçoit le
titre et le type canoniques ainsi que la progression autoritaire; sa dernière
URL utile reste celle de la page effectivement observée.

## Conséquences

Le popup ouvre la dernière page effectivement observée sans appel réseau et met
à jour la progression sans contrôle manuel lorsqu’une hausse est sûre. Le cache
peut disparaître sans perte métier et ne prétend pas connaître une œuvre
terminée lorsque cette information n’est pas fournie. Toute analyse DOM future
ou permission supplémentaire exigera une décision séparée.
