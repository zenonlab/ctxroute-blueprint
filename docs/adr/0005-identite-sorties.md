# ADR 0005 — Identité et ordre des sorties

- Statut : accepté
- Date : 2026-08-02

## Décision

Une `release` logique contient :

- `media_id` ;
- `kind` : chapitre ou épisode ;
- `sequence_key` : saison, cour, arc ou séquence principale ;
- `volume_key` éventuel ;
- `number_raw` ;
- `number_decimal` éventuel ;
- `part_key` éventuel, par exemple `a` ;
- `special_key` éventuel ;
- `sort_key` déterministe dans sa séquence ;
- `identity_confidence`.

Une `release_origin` contient la source et sa représentation :

- `source_target_id` et `source_release_key` ;
- URL ;
- langue ;
- édition/version ;
- groupe ou diffuseur ;
- date de publication ;
- libellé source brut.

Deux origines fusionnent vers la même sortie logique uniquement si œuvre, type, séquence et numéro/partie concordent avec forte confiance. Sinon elles restent distinctes et peuvent être fusionnées manuellement plus tard.

## Ordre et progression

- Une progression est un curseur structuré, pas un nombre global.
- Le maximum n'est calculé que dans une même `sequence_key` et sur des sorties principales comparables.
- Un spécial n'avance pas automatiquement la séquence principale.
- Le passage saison 1 → saison 2 suit une transition explicite de séquence.
- Les valeurs non ordonnables restent visibles sans modifier automatiquement la progression.

## Conséquences

Les chapitres `12`, `12a`, `12.5`, les spéciaux et les nouvelles saisons restent représentables sans progression arbitraire.
