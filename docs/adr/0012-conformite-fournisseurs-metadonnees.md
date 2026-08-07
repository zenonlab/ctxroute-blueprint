# ADR 0012 — Politique fournisseur

> La liste et les finalités des fournisseurs sont remplacées par [ADR 0021](0021-responsabilites-fournisseurs.md).

Chaque fournisseur est bloqué par défaut. Une politique versionnée contient son périmètre, ses finalités, sa provenance, son quota, sa rétention, son attribution, sa purge et sa date de revue. Un provider absent ou utilisé hors finalité fait échouer le job concerné sans retirer l’œuvre locale.

Les erreurs, limites et images refusées restent observables. Aucun préchargement ou dump global n’est permis.
