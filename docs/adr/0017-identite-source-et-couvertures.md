# ADR 0017 — Identité et images

L’URL et le titre du favori servent à créer une identité locale provisoire. Le titre personnel n’est jamais canonique. AniList confirme uniquement un anime ; MangaUpdates confirme uniquement manga, manhwa ou manhua. La sélection fournisseur suit désormais l’ADR 0022 : correspondance normalisée/compacte unique et traçable ; les résultats insuffisamment probants restent dans la review. Sans résultat, l’identité locale reste visible.

La couverture et la bannière sont téléchargées séparément depuis AniList, validées, compressées en WebP et dédupliquées par SHA-256. Une image ne confirme ni ne fusionne une identité. Les états d’erreur sont persistants. Les routes d’assets sont privées et liées au compte.
