# ADR 0007 — Versioning des waves

- Statut : accepté
- Date : 2026-08-02

## Décision

FavLib utilise un dépôt Git local sans remote public. La documentation validée forme la baseline `wave-0-docs`.

Chaque wave produit :

1. un commit identifiable ;
2. les preuves de tests automatiques ;
3. une note de test manuel ;
4. la validation ou le refus utilisateur ;
5. un tag `wave-X.Y` uniquement après validation.

Une migration irréversible exige une sauvegarde vérifiée et une procédure de restauration. Un rollback de code n'est jamais présenté comme suffisant lorsque le schéma a changé.

Les favoris réels, dumps, secrets et certificats privés ne sont jamais versionnés.

## Conséquences

Chaque sortie peut être identifiée et auditée. Un tag signifie « validé », pas simplement « compilé ».
