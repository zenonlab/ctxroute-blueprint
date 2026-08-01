# Checklist transversale complète

Cette checklist complète les waves. Elle évite de valider un parcours principal tout en oubliant l'exploitation, les erreurs ou l'isolation multi-utilisateur.

## Produit et comptes

- [ ] administrateur initial créé de manière sûre ;
- [ ] inscription publique désactivée ;
- [ ] invitation unique, expirante et révocable ;
- [ ] rôles administrateur et membre testés ;
- [ ] changement de mot de passe et révocation des sessions ;
- [ ] suppression/désactivation d'un compte définie ;
- [ ] export personnel sans données d'un autre utilisateur ;
- [ ] politique claire pour ce que l'administrateur peut voir ;
- [ ] plusieurs extensions/appareils par compte ;
- [ ] dernière activité et révocation par appareil.

## Installation locale

- [ ] démarrage avec une commande Docker Compose ;
- [ ] variables d'environnement documentées et validées ;
- [ ] aucun secret par défaut en production locale ;
- [ ] HTTPS multi-machine et certificat local expliqués ;
- [ ] nom/adresse du serveur configurable dans l'extension ;
- [ ] permission d'hôte limitée à l'origine FavLib choisie ;
- [ ] healthchecks et ordre de démarrage ;
- [ ] redémarrage machine sans perte de jobs ;
- [ ] procédure de mise à jour et retour arrière ;
- [ ] volumes et espace disque surveillables.

## Appairage de l'extension

- [ ] code court haché, expirant et à usage unique ;
- [ ] limitation des tentatives d'appairage ;
- [ ] origine serveur incluse ou validée explicitement ;
- [ ] installation qualifiée par utilisateur et appareil ;
- [ ] jetons courts, rotatifs et révocables ;
- [ ] appareil révoqué refusé immédiatement ;
- [ ] nouvelle installation sans écraser les précédentes ;
- [ ] message compréhensible si serveur inaccessible ou certificat refusé.

## Favoris Chrome

- [ ] tous les nœuds URL sont considérés localement ;
- [ ] dossiers et séparateurs traités correctement ;
- [ ] URLs `javascript:`, `file:`, internes et invalides rejetées ;
- [ ] distinction favoris synchronisés, locaux et gérés lorsque disponible ;
- [ ] import initial paginé/par lots ;
- [ ] événements créé, modifié, déplacé et supprimé ;
- [ ] événements en double idempotents ;
- [ ] file hors ligne avec reprise ;
- [ ] réconciliation périodique après événements manqués ;
- [ ] comparaison de fingerprints avant retransmission lisible ;
- [ ] collisions d'IDs Chrome entre profils impossibles côté DB ;
- [ ] déduplication des mêmes favoris Google observés sur plusieurs appareils ;
- [ ] aucune écriture dans l'arbre Chrome ;
- [ ] les non-médias évidents ne quittent jamais l'extension ;
- [ ] suppression d'un favori sans suppression brutale de l'historique.

## Tri et AniList

- [ ] normalisation prudente des titres et URLs ;
- [ ] anime contre manga/manhwa/manhua ;
- [ ] titres alternatifs, translittérés et localisés ;
- [ ] homonymes, remakes, saisons et adaptations ;
- [ ] œuvre absente d'AniList ;
- [ ] score et raisons visibles ;
- [ ] classifieur versionné ;
- [ ] seuils calibrés sur corpus ;
- [ ] aucun faux positif automatique dans le corpus critique ;
- [ ] cache AniList partagé sans mélanger les données personnelles ;
- [ ] regroupement des requêtes et respect des limites ;
- [ ] `429`, timeout et indisponibilité en mode dégradé ;
- [ ] fingerprints keyed locaux retraitables après changement de classifieur ;
- [ ] purge des données lisibles de favoris ignorés.

## Catalogue canonique

- [ ] `media` indépendant des utilisateurs et fournisseurs ;
- [ ] titres natifs, romaji, traduits et synonymes avec langue/provenance ;
- [ ] graphies originales conservées malgré normalisation ;
- [ ] index exact, trigramme et formes Unicode testés ;
- [ ] identifiants AniList/MAL/éditeur dédupliqués ;
- [ ] alias de connecteur promu seulement après preuve forte ;
- [ ] homonyme jamais lié sur le titre seul ;
- [ ] relations saison, suite, préquelle, adaptation et side story ;
- [ ] synchronisation idempotente avec checkpoint ;
- [ ] métriques de couverture, fraîcheur, erreurs et backlog ;
- [ ] fraîcheur et version du mapper enregistrées ;
- [ ] priorité de rafraîchissement adaptée au statut ;
- [ ] dernier état valide conservé si fournisseur indisponible ;
- [ ] aucun miroir massif sans source explicitement autorisée ;
- [ ] nouvelle saison signalable mais jamais ajoutée sans favori ;
- [ ] second fournisseur ajoutable derrière le même contrat.

## Pages et connecteurs

- [ ] type `work`, `chapter`, `episode`, `listing` ou `other` ;
- [ ] page précise reliée à son œuvre parente ;
- [ ] URL canonique stable malgré paramètres de tracking ;
- [ ] API/RSS/JSON-LD préférés au DOM ;
- [ ] pagination et ordre des sorties ;
- [ ] langues, groupes et éditions ;
- [ ] chapitres décimaux, lettres, spéciaux et épisode zéro ;
- [ ] doublons de sorties sur plusieurs sources ;
- [ ] dates et fuseaux horaires ;
- [ ] page vide ou structure modifiée mise en quarantaine ;
- [ ] connecteur versionné et désactivable par feature flag ;
- [ ] fixtures autorisées et tests de non-régression ;
- [ ] conditions du site, robots et limites documentés ;
- [ ] aucun contournement d'authentification ou de protection.

## Bibliothèque et œuvre précise

- [ ] une carte par œuvre malgré plusieurs favoris ;
- [ ] sources multiples avec préférence personnelle ;
- [ ] affiche absente ou cassée ;
- [ ] métadonnées AniList obsolètes ou indisponibles ;
- [ ] favoris associés visibles uniquement par leur propriétaire ;
- [ ] position favorite, dernière disponibilité et delta clairement séparés ;
- [ ] historique de détection et diagnostic ;
- [ ] ouverture de la bonne page source ;
- [ ] états suivi, en cours, pause, terminé et abandonné ;
- [ ] œuvre supprimée d'une source mais historique conservé.

## Progression

- [ ] fiche générale : progression inconnue ;
- [ ] chapitre/épisode précis : position observée ;
- [ ] favori N → N+1 : progression avancée ;
- [ ] navigation consentie sur la même œuvre favorite : progression observée ;
- [ ] page non favorite et sans parent favori : aucune observation ;
- [ ] N → N-1 : aucune régression silencieuse ;
- [ ] plusieurs favoris : consolidation explicable ;
- [ ] deux œuvres homonymes jamais croisées ;
- [ ] saison/partie correctement intégrée à l'identité d'un épisode ;
- [ ] forme brute toujours conservée avec la forme normalisée ;
- [ ] confiance et source de chaque observation ;
- [ ] recalcul possible après correction d'un parseur.

## Worker et nouveautés

- [ ] une cible publique vérifiée une seule fois pour plusieurs utilisateurs ;
- [ ] verrou transactionnel et workers concurrents ;
- [ ] budget et limite par domaine ;
- [ ] jitter et backoff exponentiel ;
- [ ] jobs persistants après crash ;
- [ ] snapshots validés avant remplacement ;
- [ ] diff déterministe ;
- [ ] événements et notifications dédupliqués ;
- [ ] fan-out vers les bons abonnés seulement ;
- [ ] cible inactive vérifiée moins souvent ;
- [ ] déclenchement manuel administrateur limité et journalisé ;
- [ ] horloge de test contrôlable.
- [ ] annonce catalogue distincte d'une origine disponible ;
- [ ] horaire anime utilisé pour rapprocher les vérifications ;
- [ ] disponibilité manga/manhwa/manhua confirmée par un connecteur ;
- [ ] rapprochement annonce/origine sans doublon ;

## Cache

- [ ] cache extension limité aux fingerprints et événements minimaux ;
- [ ] `chrome.storage.local` jamais présenté comme chiffré ;
- [ ] cache AniList avec TTL, provenance et version de normalisation ;
- [ ] cache d'inspection et snapshot indexés par contexte complet ;
- [ ] cache négatif court ;
- [ ] `Retry-After` respecté ;
- [ ] dernier snapshot valide conservé après erreur ;
- [ ] âge/stale visible dans l'interface ;
- [ ] invalidation favori/connecteur/locale/région/canonicalisation ;
- [ ] verrou anti-stampede ;
- [ ] purge planifiée et métriques de taille ;
- [ ] aucune progression ou vue personnelle sous une clé publique ;
- [ ] aucun HTML durable, page, image de chapitre ou vidéo mis en cache ;
- [ ] Redis absent sans mesure et ADR.

## Changement de source

- [ ] plusieurs origines regroupées sous une sortie logique ;
- [ ] menu `Sources (N)` avec site, langue, édition/groupe et fraîcheur ;
- [ ] source globale préférée et surcharge par œuvre ;
- [ ] source épinglée prioritaire lorsqu'elle possède la sortie exacte ;
- [ ] continuité avant fraîcheur brute ;
- [ ] statut officiel utilisé seulement s'il est vérifié ;
- [ ] fallback autorisable/refusable par utilisateur ;
- [ ] fallback affiché et raisons consultables ;
- [ ] fallback ponctuel sans modifier la préférence ;
- [ ] source privée jamais mutualisée ou proposée ailleurs ;
- [ ] changement de source sans progression automatique ;
- [ ] migration d'URL avec alias, preuve et rollback ;
- [ ] favori Chrome jamais réécrit ;
- [ ] alternative limitée aux favoris, cibles publiques redécouvrables et catalogues autorisés ;
- [ ] API Comick non documentée refusée.

## Découverte de sources

- [ ] déclencheurs bornés et motif enregistré ;
- [ ] action utilisateur asynchrone avec diagnostic ;
- [ ] ordre favoris → catalogue → connecteurs → recherche Web ;
- [ ] recherche Web limitée aux domaines approuvés ;
- [ ] fournisseur de recherche interchangeable et clé côté serveur ;
- [ ] titre/snippet de recherche jamais considéré comme preuve ;
- [ ] contrôles SSRF avant toute inspection ;
- [ ] `discover()` optionnel, versionné et testé sur fixtures ;
- [ ] états `PENDING_CONNECTOR`, `NEEDS_REVIEW`, `VERIFIED` et `REJECTED` ;
- [ ] preuves, score, raisons et transitions auditables ;
- [ ] même URL/contexte : candidate unique et preuves multiples ;
- [ ] candidates publique et privée jamais fusionnées ;
- [ ] décision manuelle réversible ;
- [ ] candidate seule sans bibliothèque, préférence ou abonnement ;
- [ ] ouverture ponctuelle sans abonnement ;
- [ ] épinglage/fallback accepté avec abonnement seulement si favori actif ;
- [ ] dernier favori retiré : abonnements et préférences désactivés ;
- [ ] audio, sous-titres, langue, édition et région compatibles avant fallback ;
- [ ] première origine compatible : une alerte par défaut ;
- [ ] origine suivante : `Sources (N)` seulement ;
- [ ] alerte d'origine préférée tardive optionnelle ;
- [ ] source privée liée à l'installation et jamais exposée ;
- [ ] domaine proposé soumis à validation administrateur et sous-wave ;
- [ ] budgets utilisateur/instance/domaine et cooldown ;
- [ ] CAPTCHA/paywall/anti-bot produit un diagnostic, jamais un contournement.

## Inbox et notifications

- [ ] inbox personnelle regroupée par œuvre ;
- [ ] nouvelle sortie sur source préférée ou secondaire clairement indiquée ;
- [ ] langue et édition affichées ;
- [ ] notification immédiate et digest configurables ;
- [ ] notification envoyée une seule fois ;
- [ ] erreur d'envoi rejouable sans recréer l'événement ;
- [ ] Web et ntfy facultatifs ;
- [ ] aucun titre sensible dans une notification si l'utilisateur le désactive ;
- [ ] ouverture de notification vers la bonne œuvre/source.

## Sécurité

- [ ] isolation Alice/Bob testée sur chaque endpoint personnel ;
- [ ] mots de passe hachés avec algorithme adapté ;
- [ ] sessions et jetons hachés/révocables ;
- [ ] CSRF, XSS et injections testés ;
- [ ] SSRF : DNS, IP, redirections et rebinding contrôlés ;
- [ ] IP privées interdites sauf origines explicitement administrées ;
- [ ] limites de taille, timeout et redirections ;
- [ ] HTML tiers jamais exécuté côté serveur ;
- [ ] aucun cookie tiers collecté ;
- [ ] content scripts incapables d'utiliser le service worker comme proxy arbitraire ;
- [ ] CSP de l'extension conservée stricte ;
- [ ] dépendances et licences auditées ;
- [ ] secrets et URLs sensibles absents des logs.

## Confidentialité

- [ ] finalité de la permission `bookmarks` expliquée ;
- [ ] données envoyées et durées de conservation documentées ;
- [ ] favoris non médias purgés ;
- [ ] administrateur sans écran d'espionnage des favoris et modèle de confiance système affiché ;
- [ ] export et suppression personnelle ;
- [ ] sauvegardes protégées ;
- [ ] métriques agrégées sans URL brute ;
- [ ] aucun appel à Google Identity nécessaire ;
- [ ] passage futur au cloud traité comme un nouveau consentement, pas une simple migration.

## UX et accessibilité

- [ ] chargement, vide, succès, erreur, hors ligne et obsolète ;
- [ ] permission refusée et appairage expiré ;
- [ ] source cassée distincte d'une absence de nouveauté ;
- [ ] interface clavier complète ;
- [ ] contraste AA ;
- [ ] focus visible et ordre logique ;
- [ ] labels et annonces de statut ;
- [ ] réduction de mouvement ;
- [ ] desktop, tablette et mobile ;
- [ ] textes longs, titres japonais et translittérations ;
- [ ] dates localisées et fuseau Europe/Paris configurable ;
- [ ] thème clair, sombre et système sans flash.

## Performance

- [ ] imports par lots avec limites ;
- [ ] index DB sur clés utilisateur, cible et déduplication ;
- [ ] pagination bibliothèque, inbox et diagnostics ;
- [ ] images dimensionnées et chargées paresseusement ;
- [ ] cache AniList et requêtes mutualisées ;
- [ ] aucune liste massive rendue sans virtualisation si nécessaire ;
- [ ] bundle Web et extension mesuré ;
- [ ] objectifs de temps pour import, tri, fiche œuvre et inbox ;
- [ ] test avec corpus de favoris important.

## Observabilité

- [ ] logs structurés avec request/job ID ;
- [ ] métriques importés/reconnus/ambigus/ignorés ;
- [ ] santé par connecteur et domaine ;
- [ ] durée, erreurs et prochaine exécution des jobs ;
- [ ] taux de faux positifs et corrections de matching ;
- [ ] espace DB et files en attente ;
- [ ] diagnostics compréhensibles sans exposer de données privées ;
- [ ] horodatage UTC stocké et affichage localisé.

## Sauvegarde et migrations

- [ ] sauvegarde PostgreSQL documentée ;
- [ ] restauration sur base neuve testée ;
- [ ] export personnel versionné ;
- [ ] migrations ascendantes testées ;
- [ ] stratégie de rollback ou sauvegarde avant migration irréversible ;
- [ ] compatibilité extension/API pendant une mise à jour ;
- [ ] conservation des observations brutes nécessaires au recalcul ;
- [ ] politique de rétention des snapshots et check runs.

## Tests et livraison

- [ ] unités : normaliseurs, scores, progression et diff ;
- [ ] contrats : extension/API et connecteurs ;
- [ ] intégration : PostgreSQL et worker ;
- [ ] end-to-end : deux utilisateurs et deux profils ;
- [ ] fixtures de pages cassées ;
- [ ] tests de concurrence et reprise après crash ;
- [ ] tests de sécurité automatisés pertinents ;
- [ ] checklist manuelle de la wave ;
- [ ] note de version et limites connues ;
- [ ] commande de démarrage reproductible ;
- [ ] registre de validation mis à jour.

## Définition globale de « terminé »

Une fonctionnalité est terminée seulement si son parcours normal, ses erreurs, son isolation multi-utilisateur, ses tests, ses migrations, ses diagnostics et sa documentation sont livrés ensemble. Une wave ne peut pas masquer un échec de connecteur derrière un état vide ni valider une donnée personnelle uniquement par un contrôle côté interface.
