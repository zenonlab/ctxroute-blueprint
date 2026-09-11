---
scope:
  - pocs/macos-connector/
  - docs/architecture/src/theme-customization.dataflow.json
review: on-change
revised: true
---
# ADR-0077 — UI privée du thème et liaisons de sessions stables

- Status: accepted
- Date: 2026-09-11

## Context

Le thème externe 3D ne fournissait que sa recette de scène et sa couverture. Le
connecteur ne pouvait donc ni habiller ses contrôles avec des ressources locales
du jeu, ni présenter des choix de pilote et de véhicule sans coder un jeu dans
Swift. Le modèle de personnalisation ne portait pas non plus l'identité de session.

## Decision

Le descripteur externe peut référencer un manifeste optionnel
`orbite.theme-interface/1`. Ce manifeste associe des slots sémantiques aux PNG
privés, vérifiés par chemin contenu, fichier ordinaire, taille et SHA-256. Les slots
obligatoires couvrent audio, fichiers du bureau, luminosité, piste, curseur et fond
du customiseur. Les choix de personnage et véhicule restent des données du package.
Le noyau ne connaît aucun nom de jeu ni chemin de ROM. Le customiseur présente ces
choix comme une galerie d'images du package ; il ne fabrique pas de pictogramme
système et conserve les sessions dans un contrôle séparé.

Un choix peut déclarer une application visuelle bornée par `part`, matériau et
teinte RGBA. Le RenderHost vérifie que la cible, le part et le matériau existent
dans la scène résolue, clone le matériau par instance et restaure l'original au
reset. Une variante ne peut donc modifier ni l'identité, ni la trajectoire, ni la
session d'un véhicule.

Une instance peut porter `session_id`. Les changements d'apparence conservent cette
identité. Le protocole de session accepte uniquement des instantanés monotones et
les intentions corrélées `focus` et `open`; il ne transporte ni PTY, ni texte, ni
commande shell. Les doublons et événements périmés sont refusés.

La luminosité est une valeur absolue bornée de 0 à 1 et non un toggle. Le contrôle
de thème émet `setBrightness`; son adaptateur ne doit jamais prétendre modifier un
écran physique sans capacité macOS qualifiée.

## Consequences

Un autre jeu peut remplacer tous les visuels et choix par sa propre bibliothèque
privée sans recompilation du connecteur. Un package sans manifeste UI reste valide,
mais aucune interface habillée ne peut être revendiquée. La présence d'un PNG ne
confère aucune capacité OS et la sélection d'une session ne change ni trajet ni
apparence.
