# Modèle de menace FavLib

## Portée

Ce document couvre la V1 locale multi-utilisateur : navigateur Web, extension Chrome, Caddy, Next.js, Fastify, PostgreSQL, worker, sauvegardes et fournisseurs/sites externes. Il ne prétend pas couvrir une exposition Internet ou un hébergement cloud, qui imposeraient un nouvel ADR et une nouvelle revue.

## Actifs à protéger

- comptes, hashes de mot de passe, sessions et secrets d'installation ;
- URLs favorites, rattachements d'œuvres, progression, préférences et inbox ;
- intégrité du catalogue, des annonces et des disponibilités ;
- clés fournisseur, clé de backup et volumes PostgreSQL ;
- disponibilité de l'application locale et capacité de restauration ;
- arbre de favoris Chrome, qui doit rester en lecture seule.

## Acteurs et confiance

| Acteur | Confiance | Capacité supposée |
|---|---|---|
| membre authentifié | limitée à ses données | peut envoyer des entrées malveillantes et tenter d'énumérer Bob |
| administrateur applicatif | comptes/santé uniquement | ne doit pas disposer d'un écran global de favoris |
| administrateur système de l'hôte | **de confiance** | peut lire base, volumes, processus et sauvegardes |
| navigateur/extension compromis | non fiable | peut lire le profil local et le secret d'installation de ce profil |
| page ou site tiers | hostile par défaut | HTML, redirections, URLs, JSON et scripts contrôlés par un attaquant |
| fournisseur API/dataset | non fiable techniquement et juridiquement jusqu'à revue | réponses fausses, énormes, malformées ou licence modifiée |
| autre appareil du LAN | non fiable | écoute, rejeu, brute force et accès direct aux ports exposés |
| dépendance/package | non fiable jusqu'à audit | code exécuté au build ou runtime, compromission supply-chain |

Le TLS protège le transport mais ne rend ni le LAN ni les contenus externes fiables. L'administrateur système est une limite assumée : FavLib n'offre pas de confidentialité cryptographique contre lui.

## Frontières de confiance

```text
Chrome favoris ── extension MV3 ── HTTPS/Caddy ── API ── PostgreSQL
                         │                │          │
                    pages tierces      Web UI     worker ── sites/APIs/datasets
                                                      │
                                               backup chiffré distinct
```

Chaque passage valide identité, scope, taille, schéma et contexte. Une URL ou un titre provenant d'une frontière ne devient jamais directement une identité, une requête réseau, du HTML rendu ou une décision disponible.

## Menaces et contrôles obligatoires

| Menace | Contrôle de conception | Preuve/gate |
|---|---|---|
| Alice lit ou modifie Bob | `user_id` issu de l'auth, requêtes propriétaires, réponse non énumérable | matrice par endpoint dès Wave 1 puis chaque wave |
| vol/fixation de session | secret opaque haché, cookie `__Host-`, rotation, expirations, CSRF/Origin | ADR 0014, Wave 1 |
| brute force/inscription abusive | limitation compte/IP, résultat générique et politique de mot de passe | Wave 1 |
| extension utilisée comme proxy | scopes appareil, origine FavLib exacte, domaines/permissions explicites, aucune URL libre | Wave 3 |
| perte ou duplication d'événements MV3 | persistance avant réseau, idempotence, acquittement et réconciliation | Wave 3 |
| XSS via titre/HTML tiers | données rendues comme texte, CSP bornée au même hôte, aucune exécution HTML serveur | Waves 2/5/9 |
| SSRF/DNS rebinding | schémas autorisés, résolution/revalidation DNS et redirections, IP privées refusées hors cible administrée | Waves 5/8/9 |
| contenu faux = fausse sortie | annonce distincte d'origine, matching fort et connecteur versionné | Waves 4–8 |
| archive/dataset hostile | taille/checksum, ZIP Slip/bomb, staging, schéma attendu et activation atomique | Wave 4 |
| fuite dans logs/export/backup | redaction, scope personnel, chiffrement et tests Alice/Bob | toutes waves, fermeture Wave 9 |
| suppression annulée par restore | tombstones appliqués avant redémarrage | ADR 0015, Waves 1/9 |
| panne disque/ransomware | copie chiffrée distincte, rétention et restauration testée | Wave 1 puis mensuel |
| dépendance compromise | versions exactes, lockfile, scripts/install et licence revus, liste directe courte | chaque ajout package |
| déni de service externe | limites taille/délai/concurrence, budgets, backoff/circuit breaker | Waves 4–8 |
| auth/paywall/CAPTCHA contourné | arrêt et diagnostic ; aucun contournement | chaque connecteur réel |

## Risques acceptés ou hors périmètre V1

- l'administrateur système peut accéder aux données et clés présentes sur l'hôte ;
- un profil Chrome compromis peut divulguer ses favoris et son secret d'installation ; la révocation limite la suite mais n'efface pas une fuite passée ;
- un appareil endormi ou une page authentifiée non visitée peut retarder/empêcher une détection privée ; l'état doit l'indiquer ;
- le RPO peut perdre les écritures postérieures à la dernière copie externe saine ;
- FavLib ne garantit ni disponibilité d'un site tiers, ni exactitude d'un calendrier externe ;
- aucun port Internet, SSO, email, synchronisation cloud ou protection contre l'administrateur hôte dans la V1.

Un risque accepté ne doit jamais être affiché comme une propriété garantie. Toute extension de périmètre exige une décision utilisateur et une mise à jour de ce document.

## Revue obligatoire

Le modèle est revu lorsqu'une wave ajoute une frontière, un package direct sensible, un type de secret, un fournisseur, un site réel, un port réseau, un format d'archive ou une nouvelle capacité administrateur. La note de wave liste menaces nouvelles, contrôles, preuves et risque résiduel.

La V1 ne franchit pas sa gate finale sans : tests Alice/Bob, audit CSRF/XSS/SSRF, inspection des permissions extension, recherche de secrets, restauration avec tombstones et validation des risques acceptés par l'utilisateur.
