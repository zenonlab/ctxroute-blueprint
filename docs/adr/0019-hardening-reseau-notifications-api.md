# ADR 0019 — Réseau et isolation

Les appels externes passent uniquement par le worker et la gate PostgreSQL. Chaque fournisseur autorisé est borné par œuvre, finalité et opération, avec timeout, taille maximale, backoff et `429` observable. Les rôles et finalités d’AniList et MangaUpdates suivent l’ADR 0021.

Les œuvres et assets sont partagés uniquement lorsqu’un compte possède un lien valide. Les favoris, progressions et notifications restent personnels. Le reset catalogue exige une confirmation destructive exacte.
