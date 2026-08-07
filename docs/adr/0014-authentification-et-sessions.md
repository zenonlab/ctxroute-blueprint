# ADR 0014 — Authentification, sessions et appairage

## Objectif

Protéger une application locale multi-utilisateur sans supposer que le LAN, le navigateur ou l'administrateur applicatif sont intrinsèquement sûrs. L'administrateur système de l'hôte reste dans le périmètre de confiance défini par la doctrine.

## Création et récupération des comptes

- inscription normale par e-mail et mot de passe ; aucun mot de passe par défaut ;
- le premier administrateur est créé par une commande locale interactive uniquement lorsque la base ne contient aucun compte ;
- les comptes suivants utilisent une invitation administrateur opaque, à usage unique, expirant après 24 heures ;
- la V1 n'envoie aucun email de récupération : un administrateur émet un jeton de réinitialisation à usage unique, valable 30 minutes ;
- une réinitialisation de mot de passe révoque toutes les sessions Web et tous les codes d'appairage encore ouverts ; les appareils déjà appairés sont conservés ou révoqués par une décision explicite affichée à l'utilisateur ;
- le dernier administrateur actif ne peut pas supprimer son compte ni perdre son rôle sans avoir désigné un successeur.

La commande de bootstrap refuse de fonctionner si un utilisateur existe déjà. Elle n'accepte aucun secret sur la ligne de commande afin d'éviter l'historique du shell et les listes de processus.

## Mots de passe et connexion

- hachage `Argon2id` avec sel unique et paramètres encodés dans chaque hash ; minimum initial : mémoire 19 Mio, 2 itérations, parallélisme 1, à recalibrer sur l'hôte au scaffold sans descendre sous ce seuil ;
- rehash transparent après une connexion réussie lorsque la politique augmente ;
- longueur minimale 15 caractères en l'absence de MFA, maximale au moins 128, espaces, collage et Unicode acceptés, aucune règle de composition arbitraire ;
- rejet des mots de passe courants ou compromis par une liste locale versionnée et auditée ; aucun mot de passe ou dérivé n'est envoyé à un service externe ;
- aucun mot de passe tronqué, journalisé, chiffré de manière réversible ou stocké dans une fixture ;
- message identique pour compte inconnu, désactivé ou mot de passe erroné ;
- limitation par compte normalisé et par IP, cooldown exponentiel borné et événement de sécurité agrégé ; aucun verrouillage permanent exploitable en déni de service ;
- comparaison en temps constant lorsque le type de secret le permet.

La politique suit les minima de l'[OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) et de l'[OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html). Toute modification de paramètres est une migration de politique, pas une réécriture irréversible de hashes.

## Session Web

La session est un identifiant opaque aléatoire d'au moins 256 bits. Seul son hash est conservé en base.

- cookie `__Host-favlib_session`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, sans attribut `Domain` ;
- rotation après connexion, changement de mot de passe, élévation ou retrait de rôle ;
- expiration initiale : 12 heures d'inactivité et 7 jours absolus ;
- révocation immédiate côté serveur à la déconnexion, suppression du compte ou action administrateur ;
- aucune identité ou autorisation n'est déduite d'une valeur envoyée par le client ;
- les mutations Web exigent un jeton CSRF lié à la session et une vérification stricte de `Origin`; `SameSite` est une défense supplémentaire, pas l'unique protection ;
- CORS est fermé par défaut : seule l'origine FavLib configurée est acceptée.

Les attributs et rotations suivent les [recommandations OWASP de gestion de session](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) et la protection CSRF suit l'[OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

## Appairage et jeton d'installation

- code d'appairage aléatoire, à usage unique, valable 10 minutes, affiché seulement au membre authentifié ;
- échange lié à `user_id`, `installation_id`, origine FavLib et version de protocole ;
- secret d'installation opaque, haché en base, limité aux routes appareil/favoris/observations privées de son propriétaire ;
- le secret n'accorde jamais un rôle administrateur et ne crée jamais de session Web ;
- rotation tous les 30 jours après un échange authentifié réussi, avec fenêtre de reprise bornée pour ne pas perdre la file hors ligne ;
- révocation par installation, date de dernière utilisation et diagnostic de version obsolète ;
- secret stocké uniquement dans `chrome.storage.local`, explicitement présenté comme non chiffré ; aucune copie dans les logs ou exports.

## Journal de sécurité

Sont conservés pendant 90 jours : connexion réussie/échouée agrégée, création et consommation d'invitation, changement de rôle, réinitialisation, révocation et bootstrap. Le journal contient identifiant d'événement, acteur, cible opaque, date UTC, résultat et request ID, jamais mot de passe, jeton, URL favorite ni contenu tiers.

L'interface administrateur montre les événements de sécurité mais aucun favori personnel. L'administrateur système peut lire la base et reste donc une autorité de confiance distincte.

## Tests exigés

- bootstrap possible uniquement sur base vide et sans secret en argument ;
- invitation expirée, rejouée ou déjà consommée refusée ;
- message de connexion générique et limitation compte/IP ;
- fixation de session, expiration inactive/absolue, rotation et révocation ;
- CSRF, `Origin`, attributs cookie et CORS ;
- Alice ne lit, ne révoque et ne renouvelle aucune session ou installation de Bob ;
- code d'appairage rejoué/expiré et jeton d'installation hors scope refusés ;
- aucun secret dans réponses d'erreur, logs, OpenAPI, fixtures ou export.

## Conséquences

La Wave 1 implémente comptes, invitations et sessions Web. La Wave 3 implémente l'appairage et les secrets d'installation. Une authentification fédérée, un envoi d'email ou une exposition Internet exigeraient un nouvel ADR et un nouveau modèle de menace.
