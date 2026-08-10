# ADR 0027 — Visibilité personnelle du contenu adulte

- Statut : accepté
- Date : 2026-08-10
- Remplace : ADR 0026 pour la portée globale de l’exclusion

## Décision

La taxonomie exacte de l’ADR 0026 est conservée, mais sa visibilité devient une
préférence personnelle `allow_adult`, désactivée par défaut et isolée par
utilisateur. La fonction SQL `favlib_content_allowed(media_id,user_id)` est
l’autorité commune des lectures de la bibliothèque, du calendrier, des détails,
relations, images, reviews, notifications, disponibilités et résolutions de
l’extension.

`Mature`, `Ecchi`, `Adult cast` et toute correspondance partielle restent
autorisés. Les classifications d’âge et démographies fournisseur ne redeviennent
pas des métadonnées catalogue.

## Enrichissement et inventaire

La préférence ne bloque jamais la collecte ou la conservation des preuves
fournisseur. Le favori brut demeure dans l’inventaire ; seul son classement et
les surfaces personnelles sont masqués quand l’opt-in est désactivé. Changer la
préférence ne modifie ni favori, ni progression, ni résolution manuelle.

La migration rouvre seulement les enrichissements terminés avec
`BLOCKED_CONTENT_TAXONOMY` et les décisions techniques `content-excluded`. Toute
décision utilisateur reste immuable.

## Retour arrière

Un retour arrière traite toutes les préférences comme `false` et peut réactiver
temporairement la barrière globale. La colonne additive `allow_adult` n’est pas
supprimée afin de préserver l’état utilisateur et permettre un rétablissement
sans perte.
