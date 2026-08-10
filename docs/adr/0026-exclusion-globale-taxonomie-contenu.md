# ADR 0026 — Exclusion globale par taxonomie de contenu

- Statut : accepté
- Date : 2026-08-10

## Décision

FavLib n'expose plus de préférence adulte. Une œuvre est exclue de la bibliothèque,
du calendrier, des détails, des couvertures et des candidats de review dès qu'un
genre ou une catégorie de la liste bloquée partagée est présent. La règle est la
même pour AniList, MangaUpdates et le fallback MangaDex.

La comparaison est exacte après normalisation Unicode, casse et ponctuation. Les
genres bloqués sont `Adult`, `Erotica`, `Hentai` et `Smut`. Les catégories bloquées
sont les libellés explicitement sexuels versionnés dans `@favlib/metadata`, dont
`18+`, contenu sexuel explicite ou graphique, pornographie, `Lolicon` et `Shotacon`.
`Ecchi`, `Mature`, `Adult cast` et les correspondances par sous-chaîne ne suffisent
pas.

Les classifications d'âge et démographies fournisseur ne sont plus retenues dans
les assertions catalogue et ne produisent plus de facettes. Une migration les
purge et supprime `allow_adult`.

## Provenance et inventaire

Le favori HTTP(S) brut n'est jamais supprimé. Lors d'une exclusion détectée par le
worker, `classification_status` devient `excluded` et l'évidence du lien conserve
le fournisseur, le champ, le libellé brut et sa forme normalisée. Les décisions de
review déjà résolues restent immuables ; la barrière de lecture globale empêche
néanmoins l'œuvre d'être présentée.

## Compatibilité

L'ancien endpoint de préférence reste temporairement lisible avec une valeur
immuable `false`; toute tentative de modification reçoit `409`. Les anciens
paramètres de facettes inconnus ne changent plus la projection.
