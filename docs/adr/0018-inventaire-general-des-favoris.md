# ADR 0018 — Inventaire général des favoris

- Statut : accepté
- Date : 2026-08-02
- Remplace : ADR 0002 pour la gate d'import

## Contexte

Le préfiltrage lexical de l'extension ne transmettait qu'une fraction des favoris. Un favori sans mot-clé connu ou issu d'un nouveau domaine disparaissait avant l'API, sans diagnostic possible. Cette architecture confondait entrée dans la pipeline et reconnaissance d'une œuvre.

## Décision

Après appairage explicite à l'instance FavLib locale et privée, l'extension inventorie tous les favoris HTTP(S) du profil. Elle réconcilie périodiquement leur état courant par `(user_id, installation_id, chrome_bookmark_id)` et transmet les créations, changements, déplacements et suppressions via sa file hors ligne.

Un inventaire est déclaré synchronisé uniquement après comparaison exacte de son compteur et d'une empreinte SHA-256 déterministe calculée sur les IDs Chrome et empreintes de favoris triés. Une file vide n'est jamais une preuve suffisante. Si le serveur a été vidé ou si l'empreinte diverge, l'extension reconstruit une file complète idempotente, la vide par lots de 250 et confirme ensuite le reçu au serveur.

L'API attribue à chaque favori un statut `recognized`, `review` ou `excluded` accompagné d'une raison. Aucun favori n'est silencieusement perdu. Seuls les favoris `recognized` créent une appartenance visible dans la bibliothèque et peuvent déclencher un enrichissement fournisseur.

La reconnaissance commence par une identité URL générique, fondée sur les structures de chemins et indépendante d'une liste de domaines. Les adaptateurs propres à un site améliorent ensuite précision, titre ou couverture ; ils ne bloquent jamais l'ingestion.

Les URLs et titres bruts restent dans l'instance privée. Les logs les occultent et aucun favori non reconnu n'est transmis à un fournisseur externe. Le chemin complet des dossiers Chrome n'est pas envoyé.

## Conséquences

Le compteur d'inventaire est comparable au nombre réel de favoris HTTP(S), tandis que les compteurs reconnu, à vérifier et exclu rendent les décisions auditables. Le reçu serveur, la tentative et la date de synchronisation vérifiée survivent à la fermeture du navigateur. Le volume local augmente, mais reste borné à un enregistrement courant par favori et installation.
