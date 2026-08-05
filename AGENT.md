# Règles de provenance et de résolution

- Aucune donnée fournisseur ne devient automatiquement un alias `source` ou un alias du favori. Les alias de recherche sont limités aux données du favori et à l’identité portée par son URL (`source`/`personal`).
- Aucune valeur observée pendant un test, un audit ou une recherche fournisseur ne doit être présentée comme une entrée du système sans persistance explicite et provenance correspondante.
- Toute hypothèse de matching, de type ou de rattachement doit être explicitement étiquetée et traçable dans le code, l’état d’enrichissement ou la review.
- Aucune correction spécifique à un titre ne doit être hardcodée. Les variantes et scores doivent être génériques, bornés et déterministes.
- Un résultat fournisseur est un candidat tant qu’une correspondance déterministe au seuil requis n’est pas établie. Une review ne sélectionne jamais automatiquement le premier résultat.
