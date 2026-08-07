# ADR 0016 — Mise à jour opt-in des favoris depuis une page approuvée

## Décision

L’extension conserve l’invariant « aucun arbre de favoris modifié » par défaut. Depuis la v5, le serveur est l’autorité pour la préférence explicitement activée, les propositions, leurs résultats et l’historique. `chrome.storage.local` n’est qu’un cache et conserve la file d’import ainsi que les résultats locaux non acquittés.

Les cas ambigus demandent confirmation. Aucun dossier n’est déplacé, aucun autre favori n’est supprimé et aucune URL alternative n’est substituée silencieusement. Chaque changement conserve l’ancienne URL et le titre dans un journal local et expose une restauration immédiate.

## Conséquences

La préférence est désactivée lors de la migration et peut être coupée à tout moment. Avant chaque écriture, la v5 relit le favori courant, exige l’opt-in serveur en cache et contrôle l’approbation ainsi que la permission d’hôte du domaine. Elle acquitte `APPLIED`, `CANCELLED`, `STALE` ou `FAILED` seulement après le résultat local. Si elle redémarre entre l’écriture Chrome et l’acquittement, la valeur cible déjà présente est reconnue comme application réussie et acquittée une seule fois.
