---
scope:
  - docs/templates/animation-semantics.schema.json
  - docs/templates/game-theme-authoring-run.schema.json
  - scripts/verify-animation-semantics.mjs
  - scripts/verify-game-theme-authoring-run.mjs
  - docs/architecture/theme-customization.md
  - docs/architecture/src/game-transformation.architecture.json
  - .agents/skills/game-theme-author/
review: on-change
revised: true
---
# ADR-0085 — Sémantique d’animation typée avant conversion

- Status: accepted
- Date: 2026-09-12

## Contexte

Un index de clip et une affirmation générale sur sa durée ne suffisent pas à reproduire
une animation source. Le mode de lecture peut venir du fichier, d’une table ou du code
de l’acteur. La borne finale peut être inclusive ou exclusive, les animations de
matériau et de visibilité suivent des pistes distinctes, et les événements peuvent
être déclenchés lors du franchissement d’une frame. Une boucle déduite visuellement
peut donc introduire un raccord téléporté, un événement rejoué ou un double root motion.

## Décision

Chaque campagne d’adaptation lie son ledger par SHA-256 à un manifeste
`orbite.animation-semantics/1`. Il décrit chaque clip indépendamment du moteur source :
famille de cible, identités source, timebase rationnelle, domaine d’échantillonnage,
politique de borne, mode de lecture, point de répétition, propriétaire unique du
mouvement, événements, transitions et preuves déterministes.

Le domaine peut contenir une seule pose avec `start_tick == end_tick` lorsqu'une
source fournit explicitement une animation non bouclée de durée zéro. Une boucle
conserve obligatoirement un domaine non vide ; le pipeline ne fabrique jamais une
frame supplémentaire pour contourner cette différence.

Une boucle qualifiée exige quatre sondes (`start`, `repeat_start`, `pre_end`,
`post_wrap`) et des écarts mesurés inférieurs aux limites déclarées. Un clip non
bouclé exige une sonde de fin et ne peut porter de couture artificielle. Les événements
restent dans le domaine source et déclarent une politique de livraison bornée. Les
transitions ne peuvent viser que des clips et marqueurs connus.

Le manifeste reste générique : les noms de formats ou symboles source sont des valeurs
opaques, jamais des branches du runtime. La lecture des fichiers et du code appartient
à l’adaptateur hors ligne. Un gate animation `pass` avec un clip non résolu est refusé.

## Conséquences

Le premier aperçu arrive plus tard, mais la décision de boucler, tenir, réinitialiser
ou mélanger n’est plus un réglage visuel. Les animations squelettiques, matériau,
texture, visibilité, caméra et morph sont inventoriées séparément. Un jeu sans table
globale reste supportable : l’adaptateur matérialise les lignes depuis les appels du
contrôleur source, avec symbole, révision et preuve locale.
