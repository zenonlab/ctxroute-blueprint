# ADR 0016 — Mise à jour opt-in des favoris depuis une page approuvée

## Décision

L’extension conserve l’invariant « aucun arbre de favoris modifié » par défaut. Une préférence locale explicitement activée autorise uniquement la mise à jour du titre et de l’URL d’un favori existant lorsqu’une page d’un domaine approuvé fournit une séquence suivante clairement identifiable.

Les cas ambigus demandent confirmation. Aucun dossier n’est déplacé, aucun autre favori n’est supprimé et aucune URL alternative n’est substituée silencieusement. Chaque changement conserve l’ancienne URL et le titre dans un journal local et expose une restauration immédiate.

## Conséquences

La préférence est désactivée lors de la migration et peut être coupée à tout moment. Les permissions d’hôte restent explicites et limitées au domaine approuvé. Une révocation ou une erreur réseau ne déclenche aucune modification.
