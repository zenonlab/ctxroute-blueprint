# ADR 0002 — Confidentialité de l'import

- Statut : accepté
- Date : 2026-08-02

## Contexte

Lire tous les favoris est nécessaire pour ne pas imposer un dossier spécial. Envoyer toutes les URLs et tous les titres au serveur avant tri exposerait toutefois des données sans rapport avec FavLib.

## Décision

Tous les favoris URL sont examinés dans l'extension, mais tous ne sont pas envoyés.

Le classifieur local de niveau 0 élimine les schémas invalides, pages internes, domaines explicitement non médias et favoris sans aucun signal média. Il utilise une configuration de données signée/versionnée, jamais du code distant.

Seuls les candidats médias sont envoyés à l'API locale avec le minimum nécessaire : ID d'observation qualifié, URL normalisée, titre et indice de type. Le chemin complet du dossier Chrome n'est pas envoyé ; seule une catégorie locale explicitement autorisée peut servir d'indice.

Les candidats ignorés par le serveur sont purgés sous 24 heures. Un fingerprint keyed conservé dans l'extension évite leur renvoi à chaque réconciliation. Les favoris reconnus conservent leur URL parce qu'elle est nécessaire à la surveillance ; les ambiguïtés sont conservées jusqu'à décision ou expiration configurée.

Les tables temporaires de classification sont exclues des exports personnels et des sauvegardes applicatives. Logs et métriques ne contiennent pas d'URL brute.

## Modèle de confiance

L'administrateur de la machine hôte est considéré comme fiable : il peut techniquement lire PostgreSQL, les volumes et les sauvegardes. FavLib garantit l'isolation applicative entre comptes, pas le secret cryptographique face à l'administrateur système.

Ce point doit être affiché pendant l'inscription à une instance locale multi-utilisateur.

## Conséquences

Lorsqu'un fournisseur est autorisé, son API ne reçoit que des candidats plausibles. Le coût, le risque de fuite et le volume de classification diminuent, tout en conservant la promesse que chaque favori est examiné. Sans politique `AUTHORIZED`, aucun candidat ne lui est envoyé.
