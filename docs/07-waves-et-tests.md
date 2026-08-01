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

## Environnement de test local

- Docker Compose identique au déploiement local ;
- deux comptes de seed : Alice et Bob ;
- deux installations d'extension distinctes ;
- le jeu synthétique `fixtures/bookmarks/wave-0.synthetic.json` ;
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
- création/invitation/expiration ;
- cookie et révocation de session ;
- routes membre contre routes administrateur ;
- test systématique Alice ne peut pas lire une ressource de Bob ;
- healthcheck de chaque conteneur.

### Test manuel de sortie

1. Démarrer avec une commande.
2. Créer Alice et Bob.
3. Se connecter dans deux sessions privées.
4. Vérifier les écrans autorisés.
5. Redémarrer les conteneurs et confirmer la persistance.

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
- reprise hors ligne ;
- réconciliation après événement manqué ;
- révocation d'une installation.

Vérifier également qu'un favori non-média ne quitte jamais l'extension, qu'un candidat serveur ignoré est purgé sous 24 heures et qu'une nouvelle version du classifieur peut demander un réexamen local.

### Test manuel de sortie

1. Appairer deux profils à Alice et un à Bob.
2. Importer les favoris.
3. Relancer l'import et vérifier zéro doublon.
4. Modifier un favori hors ligne puis reconnecter.
5. Révoquer un appareil et confirmer son refus immédiat.

## Wave 4

### Corpus minimal

- liens sans rapport avec les médias ;
- titres exacts AniList ;
- titres alternatifs et translittérés ;
- homonymes ;
- pages de série, chapitre et épisode ;
- manhwa classé comme manga par AniList ;
- œuvre absente d'AniList ;
- URL contenant un numéro sans être une sortie.

### Mesures

- précision des liaisons automatiques ;
- taux de faux positifs ;
- taux envoyé à « À vérifier » ;
- explication du score ;
- comportement AniList indisponible ou limité.

Aucun seuil n'est validé si une liaison automatique fausse apparaît dans le corpus critique.

## Wave 5

### Tests automatiques

- type de page correct ;
- URL parent et cible canonique ;
- extraction chapitre/épisode ;
- normalisation `12`, `12.5`, `12a`, `SP-3` et zéro ;
- pagination éventuelle ;
- résultat vide en quarantaine ;
- changement de fixture détecté comme parseur cassé.

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

## Wave 9

### Validation finale

- notification envoyée une fois ;
- digest personnel ;
- restauration sur une base neuve ;
- rotation/révocation des jetons ;
- audit SSRF et XSS ;
- vérification des permissions de l'extension ;
- aucun cookie tiers dans les sauvegardes ou journaux ;
- fonctionnement documenté après redémarrage machine et indisponibilité réseau.

## Registre de validation

À la fin de chaque wave, ajouter une entrée :

| Wave | Version | Tests auto | Test utilisateur | Anomalies | Décision | Date |
|---|---|---|---|---|---|---|
| 0 | baseline documentaire | revue technique complète | à valider | voir `VALIDATION-WAVE-0.md` | en attente | 2026-08-02 |
