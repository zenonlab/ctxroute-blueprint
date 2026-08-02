# Plan de test de chaque wave

## Contrat de sortie commun

Chaque wave doit fournir dans sa note de version :

```text
Version : wave-X.Y
Objectif : résultat utilisateur observable
Installation/migration : commandes exactes
Tests automatiques : commande + résultat
Tests manuels : checklist
Données de test : seed/fixtures utilisés
Limites connues : liste explicite
Retour arrière : procédure et compatibilité DB
Décision : validée / corrigée / refusée
```

Une sortie n'est pas validée uniquement parce qu'elle compile. Le comportement doit être observable depuis l'interface ou l'extension.

Chaque wave vérifie aussi que l'OpenAPI généré correspond aux schémas Zod, que les réponses d'erreur sont stables et qu'une route personnelle refuse une session absente, révoquée ou appartenant à un autre utilisateur.

## Environnement de test local

- Docker Compose identique au déploiement local ;
- deux comptes de seed : Alice et Bob ;
- deux installations d'extension distinctes ;
- le jeu synthétique `fixtures/bookmarks/wave-0.synthetic.json` ;
- le catalogue multi-alias `fixtures/catalog/wave-0.media-aliases.json` ;
- le dataset importable `fixtures/catalog/wave-0.dataset-manifest.json` et son artefact NDJSON ;
- les candidates `fixtures/discovery/wave-0.discovery.json` ;
- des fixtures de sites stables ;
- horloge et jobs déclenchables manuellement en test ;
- boîtes de réception séparées ;
- sauvegarde de la base avant chaque migration importante.

## Wave 0

### Validation manuelle

- la distinction favori/disponibilité/progression est comprise ;
- tous les favoris sont examinés localement et les non-médias ne quittent pas l'extension ;
- aucune modification des favoris Chrome n'est prévue ;
- les décisions multi-utilisateur/local/privé sont présentes partout ;
- les premiers scénarios de test sont acceptés.

## Wave 1

### Tests automatiques

- migrations depuis une base vide ;
- versions effectives Node.js 24 LTS et PostgreSQL 18 exposées dans le diagnostic de test ;
- installation reproductible depuis le lockfile, sans dépendance RC/canary implicite ;
- création/invitation/expiration ;
- bootstrap refusé sur base non vide et sans secret passé en argument ;
- Argon2id conforme aux minima, rehash de politique et absence de secret dans les logs ;
- cookie sécurisé, CSRF/Origin, rotation, expirations et révocation de session ;
- limitation de connexion par compte/IP avec message générique ;
- routes membre contre routes administrateur ;
- test systématique Alice ne peut pas lire une ressource de Bob ;
- enveloppe d'erreur sans fuite, curseurs stables, limites de corps et `X-Request-Id` ;
- même `Idempotency-Key` et même corps rejoués sans effet, corps différent refusé en `409` ;
- healthcheck de chaque conteneur ;
- création d'un `pg_dump -Fc`, chiffrement, checksum et manifest ;
- restauration automatique sur un PostgreSQL vide avec contrôle des contraintes et fixtures Alice/Bob ;
- dump corrompu, mauvaise clé ou espace insuffisant : échec visible sans statut `BACKUP_HEALTHY` ;
- job de sauvegarde rejoué sans écraser la dernière copie saine.

### Test manuel de sortie

1. Démarrer avec une commande.
2. Créer Alice et Bob.
3. Se connecter dans deux sessions privées.
4. Vérifier les écrans autorisés.
5. Redémarrer les conteneurs et confirmer la persistance.
6. Contrôler dans le diagnostic que les versions réellement exécutées correspondent à la matrice datée de `12-api-fournisseurs-et-stack.md`.
7. Restaurer la sauvegarde sur une base jetable et relever RPO/RTO observés.
8. Vérifier qu'une copie existe hors du volume/disque Docker principal.

## Wave 2

### Tests automatiques

- parcours bibliothèque → œuvre → source ;
- inbox et file « À vérifier » ;
- gestion appareils/utilisateurs ;
- viewport mobile et desktop ;
- navigation clavier et absence d'erreurs d'accessibilité majeures.

### Test manuel de sortie

Comparer les écrans aux maquettes avec le seed réaliste et valider les états vide, chargement, erreur et données nombreuses.

## Wave 3

### Tests automatiques

- code d'appairage unique, haché, expirant et non réutilisable ;
- lots idempotents ;
- comparaison locale de fingerprints et envoi sélectif des candidats modifiés ;
- collisions d'identifiants Chrome entre deux installations ;
- événements créés/modifiés/déplacés/supprimés ;
- identifiant d'extension stable après deux builds propres ;
- permission d'hôte optionnelle accordée et retirée sans élargissement silencieux ;
- reprise hors ligne ;
- service worker interrompu après écriture locale mais avant upload : reprise sans perte ni doublon ;
- quota local proche de 10 Mo : aucune écriture silencieusement perdue, diagnostic puis réconciliation ;
- budget FavLib de 5 Mio respecté sans permission `unlimitedStorage` ;
- mise à jour d'extension : migration storage atomique, alarmes recréées et ancien protocole encore accepté pendant la fenêtre prévue ;
- protocole trop ancien refusé en `426` sans perte de la file locale ;
- site authentifié sans onglet/session exploitable : `WAITING_FOR_VISIT` ou `AUTH_REQUIRED`, jamais fausse absence de nouveauté ;
- réconciliation après événement manqué ;
- révocation d'une installation.

Vérifier également qu'un favori non-média ne quitte jamais l'extension, qu'un candidat serveur ignoré est purgé sous 24 heures et qu'une nouvelle version du classifieur peut demander un réexamen local.

### Test manuel de sortie

1. Appairer deux profils à Alice et un à Bob.
2. Importer les favoris.
3. Relancer l'import et vérifier zéro doublon.
4. Modifier un favori hors ligne puis reconnecter.
5. Révoquer un appareil et confirmer son refus immédiat.
6. Rebuilder, recharger l'extension non empaquetée et confirmer que l'identifiant et l'appairage restent stables.
7. Charger l'extension non empaquetée dans deux profils Chrome distincts et vérifier l'isolation des favoris.
8. Documenter la décision de distribution durable : Chrome Web Store non répertoriée, ou politique d'entreprise uniquement sur appareils administrés.
9. Fermer Chrome pendant une échéance, le rouvrir et vérifier réconciliation/alarmes.
10. Mettre à jour/recharger l'extension avec une file non vide et vérifier migration puis acquittement.

## Wave 4

### Corpus minimal

- liens sans rapport avec les médias ;
- titres exacts du catalogue local ;
- titres alternatifs et translittérés ;
- homonymes ;
- pages de série, chapitre et épisode ;
- manhwa classé comme manga par un fournisseur autorisé ;
- œuvre absente d'AniList ;
- URL contenant un numéro sans être une sortie ;
- même œuvre en titre natif, romaji, anglais et français ;
- alias propre à deux connecteurs ;
- titre identique entre deux œuvres de type/année différents ;
- suite/saison distincte reliée à l'œuvre favorite.

### Mesures

- précision des liaisons automatiques ;
- taux de faux positifs ;
- taux envoyé à « À vérifier » ;
- explication du score ;
- AniList non autorisé : aucun appel, job, cache ou préchauffage ;
- changement de conditions : passage à `REVIEW_REQUIRED`, suspension et purge prévue ;
- hit catalogue local sans appel fournisseur ;
- miss local puis enrichissement idempotent par fournisseur autorisé ;
- suppression du cache fournisseur sans perte des preuves indépendantes ;
- provenance durable dont la rétention est autorisée ;
- manifeste de release, taille et checksum vérifiés avant staging ;
- archive trop grosse, ZIP Slip ou ratio de compression excessif rejeté avant extraction ;
- interruption/reprise au checkpoint puis activation atomique sans batch partiel visible ;
- second import identique sans doublon d'œuvre, titre, identifiant ou assertion ;
- rollback vers le batch précédent sans perte d'une correction personnelle ;
- conflit entre deux sources conservé comme deux assertions et envoyé à revue, sans écrasement silencieux ;
- redirection/suppression fournisseur appliquée à ses assertions seulement ;
- import Wikidata filtré avec licence CC0, identifiants et provenance par champ ;
- import MADB depuis une release GitHub épinglée actuelle, avec version/attribution visibles et revue des droits tiers ;
- import BnF/NDL idempotent avec ISBN/identifiant stable, date de notice distincte de la date de publication et provenance ;
- import IMDb impossible hors politique non commerciale `AUTHORIZED`, et purge totale sans perte des preuves indépendantes ;
- National Library of Korea sans politique autorisée : aucun téléchargement ni import ;
- réponse MangaUpdates mise en cache, créditée et bornée aux œuvres favorites, sans parcours exhaustif du catalogue ;
- données TVmaze isolées et attribuées conformément à CC BY-SA, sans contamination silencieuse d'une provenance plus permissive ;
- fournisseur en `REVIEW_REQUIRED`, `DISABLED` ou non configuré : zéro appel sortant ;
- rafraîchissement par statut, checkpoint et reprise ;
- renormalisation après changement de version sans perte des graphies originales.

Aucun seuil n'est validé si une liaison automatique fausse apparaît dans le corpus critique.

## Wave 5

### Tests automatiques

- type de page correct ;
- URL parent et cible canonique ;
- extraction chapitre/épisode ;
- normalisation `12`, `12.5`, `12a`, `SP-3` et zéro ;
- pagination éventuelle ;
- résultat vide en quarantaine ;
- changement de fixture détecté comme parseur cassé ;
- `discover()` retourne hints, preuves et domaine sans connecteur ;
- résultat de recherche jamais promu sans `inspect()` et matching ;
- faux positif de titre/année rejeté ;
- transition manuelle ambiguë auditée et réversible.

## Wave 6

### Scénario principal

```gherkin
Given Alice et Bob suivent la même cible publique
And le dernier snapshot contient l'épisode 11
When le connecteur retourne l'épisode 12
Then la cible est récupérée une seule fois
And Alice reçoit une nouveauté personnelle
And Bob reçoit une nouveauté personnelle
And aucun compte ne voit la progression de l'autre
And un second job identique ne crée aucun doublon
```

Tester également concurrence de workers, timeout, `429`, redirection interdite et reprise après crash transactionnel.

Tester aussi qu'une annonce TVmaze et un signal MangaUpdates accélèrent seulement la prochaine vérification : sans résultat valide du connecteur de la source, aucune `release_origin` disponible ni notification « lisible maintenant » n'est créée.

### Cache et résolution multi-source

- cache fournisseur partagé seulement si sa politique le permet, sans vue/progression personnelle partagée ;
- hit, miss, expiration et invalidation par version de connecteur ;
- deux jobs simultanés ne déclenchent qu'une recomputation par clé ;
- un échec conserve le dernier snapshot valide et affiche son âge ;
- deux origines du même chapitre apparaissent sous `Sources (2)` ;
- source épinglée saine choisie en premier ;
- source épinglée cassée : fallback proposé ou utilisé selon préférence ;
- fallback ponctuel sans changement de préférence permanente ;
- locale/région différente : snapshots distincts ;
- source privée d'Alice jamais proposée à Bob ;
- migration de domaine : alias, preuve, historique conservé et favori Chrome inchangé ;
- annonce anime sans origine : calendrier seulement, aucune notification disponible ;
- première origine valide : rapprochement annonce/sortie et un seul événement personnel ;
- chapitre manga/manhwa absent d'un site : aucune disponibilité déduite du catalogue ;
- horaire d'un fournisseur autorisé : vérification rapprochée puis backoff normal si la source n'a pas encore publié ;
- `resolve-open` refuse une URL libre ou une origine non rattachée à la sortie ;
- états API `SCHEDULED` puis `AVAILABLE` conformes au contrat sans notification intermédiaire erronée ;
- ouverture ponctuelle sans abonnement ; épinglage avec abonnement borné au favori actif ;
- retrait du dernier favori désactive préférences et abonnements personnels ;
- origine supplémentaire sans seconde notification par défaut ;
- origine préférée tardive avec événement optionnel dédupliqué ;
- variante audio/sous-titres incompatible exclue du fallback automatique ;
- source extension privée invisible à l'autre utilisateur ;
- source privée hors ligne : état périmé explicite, jamais « aucune nouveauté » ;
- deux installations privées : lease unique et reprise après expiration ;
- alarme privée recréée au réveil et upload idempotent ;
- permission privée retirée : surveillance suspendue sans effacer le dernier snapshot ;
- budget épuisé et domaine non approuvé sans fetch libre.

## Wave 7

### Scénarios critiques

- même favori modifié épisode 11 → 12 : progression 12 ;
- navigation consentie épisode 11 → 12 sur une œuvre favorite : progression observée 12 ;
- navigation sur une œuvre non favorite : aucun événement ;
- URL modifiée 12 → 11 : régression non silencieuse ;
- deux favoris chapitres 10 et 12 : une carte, progression 12 ;
- favori fiche série : abonnement actif, progression inconnue ;
- homonymes sur deux sites : aucune progression croisée ;
- événement manqué : réconciliation retrouve la nouvelle URL ;
- popup sur page précise : œuvre, position, disponible et delta corrects.

## Wave 8 — modèle pour chaque site

Chaque sous-wave de connecteur doit joindre :

- liste des formes d'URL couvertes ;
- fixtures et date de capture ;
- méthode utilisée API/RSS/JSON-LD/HTML/extension ;
- limites et fréquence ;
- tests de fiche, sortie précise, page inexistante et structure cassée ;
- capture du diagnostic dans FavLib ;
- feature flag permettant sa désactivation immédiate.

Pour un connecteur déclaratif, tester aussi domaine strictement approuvé, sélecteur absent/multiple, URL relative, regex invalide, aperçu sans sauvegarde, version précédente restaurable et impossibilité d'injecter ou d'exécuter du code. Son fetch reste soumis aux protections SSRF, taille, délai, redirections et budget du connecteur normal.

## Wave 9

### Validation finale

- export Alice versionné, borné, sans secret ni donnée de Bob, puis purge sous 24 heures ;
- suppression de compte rejouable après crash ;
- restauration d'un backup antérieur puis application des tombstones sans résurrection ;
- purges de rétention mesurées et échec observable ;

- notification envoyée une fois ;
- digest personnel ;
- restauration sur une base neuve ;
- rotation/révocation des jetons ;
- audit SSRF et XSS ;
- vérification des permissions de l'extension ;
- aucun cookie tiers dans les sauvegardes ou journaux ;
- fonctionnement documenté après redémarrage machine et indisponibilité réseau ;
- purge et métriques des tables de cache ;
- aucune réponse ou sauvegarde contenant un média tiers mis en cache.

## Registre de validation

À la fin de chaque wave, ajouter une entrée :

| Wave | Version | Tests auto | Test utilisateur | Anomalies | Décision | Date |
|---|---|---|---|---|---|---|
| 0 | baseline documentaire | revue technique complète | à valider | voir `VALIDATION-WAVE-0.md` | en attente | 2026-08-02 |
