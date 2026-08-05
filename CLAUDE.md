# Doctrine FavLib

Ce fichier est la doctrine obligatoire du dépôt. En cas de contradiction, une décision utilisateur explicite plus récente prime et doit être reportée ici et dans un ADR.

## Produit

- FavLib est privé, local et multi-utilisateur.
- Il suit mangas, manhwa, manhua et anime à partir des favoris Chrome/Google.
- Après appairage explicite à l'instance locale privée, tous les favoris HTTP(S) sont inventoriés par l'API ; seuls les favoris reconnus apparaissent dans la bibliothèque ou peuvent être enrichis à l'extérieur.
- AniList est la source canonique des anime : identité, titres, métadonnées, relations, calendrier et images. MangaUpdates est la source canonique des manga, manhwa et manhua : identité, titres associés multilingues, fiche éditoriale, statut de sérialisation, dernier chapitre/volume et releases via son API officielle. Après résolution MangaUpdates, AniList fournit également les images de lecture en prenant le premier résultat du premier alias non vide, sans changer l’identité canonique. La progression personnelle vient uniquement des favoris, de l’extension ou d’une action utilisateur consentie. Les caches sont durables, bornés et conservés avec provenance.
- PostgreSQL maintient un catalogue canonique local de titres, synonymes, identifiants et relations ; un titre seul n'est jamais une identité unique.
- Toute métadonnée durable conserve une provenance autorisant sa rétention ; rate limit et accessibilité technique ne valent pas autorisation.
- Tout dump est importé par release vérifiée, staging et assertions à provenance champ par champ ; il n'écrit jamais directement dans le catalogue canonique.
- Une annonce catalogue alimente le calendrier ; seule une origine validée par connecteur affirme qu'une sortie est disponible sur un site.
- FavLib n'héberge, ne télécharge, n'extrait ni ne republie aucun chapitre, épisode, page, audio ou vidéo tiers. Une couverture d'œuvre peut être conservée localement lorsqu'elle provient d'un connecteur borné et autorisé, avec provenance et purge.
- Aucun contournement d'authentification, paywall, CAPTCHA, DRM ou protection anti-bot.

## Invariants métier

- Le favori établit l'appartenance et la source à surveiller.
- Une origine alternative peut enrichir une œuvre déjà favorite, mais ne crée jamais seule une œuvre, un abonnement ou un favori.
- Épingler ou accepter une alternative comme fallback peut créer sa surveillance uniquement pour une œuvre possédant encore un favori personnel actif.
- Retirer le dernier favori d'une œuvre désactive ses abonnements et préférences personnels.
- Le connecteur de la source détecte les sorties disponibles.
- La progression est personnelle et distincte de la disponibilité.
- Une page précise favorite ou une navigation consentie sur la même œuvre peut produire une observation de progression.
- L'extension ne modifie jamais l'arbre des favoris.
- Une régression de progression n'est jamais silencieuse.
- Une sortie spéciale ou d'une autre saison n'est jamais comparée par un simple maximum numérique.
- Une source cassée ne doit jamais être présentée comme une absence de nouveauté.
- Une source authentifiée non vérifiable sans visite reste `WAITING_FOR_VISIT`; l'extension ne promet jamais une surveillance continue qu'elle ne peut assurer.
- Un changement de source ne modifie jamais silencieusement progression, favori ou préférence permanente.

## Multi-utilisateur

- Toute donnée personnelle porte un `user_id` ou est reliée par une contrainte vérifiable à son propriétaire.
- L'autorisation est imposée dans l'API et testée entre Alice et Bob ; un filtre dans l'interface ne constitue pas une protection.
- Les métadonnées et vérifications publiques peuvent être partagées uniquement avec un contexte de collecte identique.
- L'administrateur d'infrastructure local est dans le périmètre de confiance et peut techniquement accéder à la base et aux sauvegardes. L'interface administrateur ne doit toutefois pas exposer les favoris personnels.
- Inscription publique locale par e-mail et mot de passe ; l'administrateur peut toujours gérer les rôles et désactiver les comptes.
- Aucun compte ou mot de passe par défaut ; le bootstrap du premier administrateur est local, interactif et refusé dès qu'un compte existe.
- Sessions Web opaques hachées côté serveur ; secrets d'installation distincts, à scopes réduits et révocables.

## Extension et favoris

- Chaque profil Chrome installe et appaire sa propre extension.
- Les IDs Chrome sont qualifiés par `(user_id, installation_id, chrome_bookmark_id)`.
- Snapshot initial, événements idempotents, file hors ligne et réconciliation périodique sont obligatoires.
- Aucun filtre lexical, dossier ou domaine ne peut empêcher un favori HTTP(S) d'entrer dans l'inventaire. Chaque état courant est explicitement `recognized`, `review` ou `excluded`.
- L'identité URL générique est indépendante du domaine. Les adaptateurs de site sont des enrichissements facultatifs et ne constituent jamais une gate d'ingestion.
- Les content scripts ne s'exécutent que sur des domaines approuvés avec permission d'hôte explicite.
- Un content script ne peut jamais demander au service worker de récupérer une URL arbitraire.
- `chrome.storage.local` est persistant mais n'est pas présenté comme chiffré.

## Réseau local

- Topologie de référence : `https://favlib.home.arpa` derrière Caddy.
- `/` sert Next.js et `/api/*` sert Fastify sous la même origine.
- Caddy utilise son autorité interne ; sa racine doit être installée sur chaque appareil client.
- Aucun port du service n'est redirigé vers Internet.
- L'extension demande exactement l'origine FavLib configurée et les domaines sources nécessaires.

## Connecteurs et collecte

- Ordre obligatoire : API officielle, webhook/RSS, JSON structuré, HTML statique, extension, puis headless exceptionnel.
- Chaque connecteur est versionné, testé sur fixtures et activable par feature flag.
- Chaque fournisseur de métadonnées est bloqué par défaut jusqu'à une politique versionnée couvrant usages, rétention, attribution et purge.
- Une limite fournisseur inconnue ou non vérifiée bloque les jobs planifiés ; un plafond FavLib conservateur ne remplace pas l'autorisation du fournisseur.
- La clé de mutualisation inclut connecteur, version, URL canonique, locale, région et mode d'accès.
- Les résultats personnalisés, authentifiés ou dépendants d'une extension ne sont jamais partagés entre utilisateurs.
- Une surveillance `extension_private` est best effort, planifiée localement, idempotente et affichée comme périmée lorsque l'appareil ne peut pas vérifier.
- Le résolveur multi-source utilise seulement favoris personnels, cibles publiques redécouvrables et catalogues autorisés.
- Une URL favorite crée d’abord une identité locale provisoire. Une œuvre reconnue déclenche ensuite AniList pour un anime ou MangaUpdates pour une œuvre de lecture. Les images proviennent d’AniList sans participer à la résolution d’identité d’une œuvre de lecture.
- La découverte n'est pas exécutée à chaque cycle ; un résultat de recherche Web reste un indice jusqu'à validation par connecteur et matching fort.
- Les requêtes ont délai, taille, redirections et budget par domaine limités.
- Une résolution fournisseur essaie tous les alias dans l’ordre `source/official`, fournisseur, puis synonymes, ainsi que leurs variantes normalisées/tokenisées. MangaUpdates examine tous les résultats et fiches compatibles, rejette les romans et les fiches mortes, puis sélectionne le meilleur matching déterministe ; `OEL` n'est compatible que si la fiche prouve une publication graphique par chapitres/webcomic et ne contient aucun marqueur de roman. AniList peut rapprocher un suffixe de saison arabe/romain uniquement lorsque la base du titre est identique et la saison unique. Aucun fournisseur n'est choisi uniquement parce qu'il est premier. Un échec fournisseur ne retire jamais une œuvre reconnue de la bibliothèque.
- Une décision utilisateur de review est immuable pour l'automatisation. Une réconciliation automatique exige une identité fournisseur active du même fournisseur, `decision IS NULL`, et exclut les titres explicitement manuels. Un état d'enrichissement `TERMINAL` à version courante n'est pas ré-enqueueé sans invalidation explicite ; tout changement de sémantique de matching incrémente la version du connecteur.
- Tous les appels GraphQL AniList partagent une cadence minimale de 2,1 secondes, s’adaptent aux en-têtes `X-RateLimit-*`, regroupent au plus 50 IDs et réessaient un HTTP 429 après l’attente réellement annoncée.
- SSRF, DNS rebinding et redirections vers IP privées sont bloqués sauf cible administrée explicitement.

## Données et progression

- La forme source brute d'un numéro est conservée avec sa normalisation.
- L'identité logique d'une sortie inclut œuvre, type, séquence/saison, volume éventuel, numéro/partie et variante spéciale.
- Langue, édition, groupe et URL appartiennent à l'origine de sortie.
- Une fusion entre origines n'est automatique qu'avec une forte confiance ; sinon les sorties restent distinctes.
- La progression avance uniquement dans une même séquence ordonnée et sur une observation à forte confiance.
- Par défaut, une seule notification est produite par sortie logique à la première origine compatible ; les origines suivantes enrichissent `Sources (N)`.
- Le push externe est un résumé au plus toutes les cinq minutes par utilisateur ; l'inbox personnelle complète reste la source de vérité et chaque livraison réessaie un lot d'IDs figé.

## Stack arrêtée

- pnpm workspaces + Turborepo.
- Next.js, React, TypeScript, Tailwind CSS et shadcn/ui.
- Fastify, Zod, PostgreSQL et Drizzle ORM.
- WXT Manifest V3 pour l'extension.
- Graphile Worker pour les jobs PostgreSQL ; ne pas ajouter Redis sans ADR.
- Les caches V1 utilisent extension + PostgreSQL + TanStack Query ; aucune œuvre ou page de lecture tierce n'est mise en cache. Seules les couvertures autorisées par l'ADR 0017 peuvent l'être.
- Les datasets bruts restent hors Git, sont bornés en taille et activés par batch atomique avec rollback ; une licence incompatible reste isolée et purgeable.
- Caddy pour le reverse proxy et le TLS local.
- Vitest, Testing Library et Playwright pour les tests.

## Packages

- Épingler les versions stables au scaffold et committer le lockfile.
- Avant tout package direct : vérifier besoin, licence, maintenance, poids et surface de sécurité.
- Ne pas ajouter un second kit UI.
- Conserver `THIRD_PARTY_NOTICES.md` pour les licences requises.
- Aucun code GPL repris dans FavLib sans décision explicite de licence.

## Waves et gates

- Une seule wave de produit à la fois.
- Chaque wave fournit migrations, seed/fixtures, tests automatiques, checklist manuelle, limites connues et retour arrière.
- Une sauvegarde n'est saine qu'après checksum, déchiffrement et restauration réussie sur une base neuve ; créer un fichier ne suffit pas.
- Ne jamais marquer une wave validée sans preuve de tests et validation utilisateur demandée.
- Toute nouvelle table documente propriétaire/scope, finalité, export, rétention, purge et comportement après restauration.
- Une restauration applique les tombstones courants avant redémarrage afin de ne pas réactiver un compte supprimé ou un secret révoqué.
- Une sous-wave séparée est obligatoire pour chaque nouveau site réel.
- À partir de la Wave 1, les commandes racine obligatoires sont : `pnpm lint`, `pnpm typecheck`, `pnpm test` et, lorsque pertinent, `pnpm test:e2e`.
- Le dépôt doit rester exécutable depuis une copie propre avec les commandes documentées.

## Git

- Dépôt local privé, sans remote public.
- Baseline `wave-0-docs` après validation documentaire.
- Une branche ou un commit identifiable par wave et un tag uniquement après validation.
- Aucun secret, favori réel, cookie, dump ou certificat privé dans Git.
- Les fixtures sont synthétiques ou anonymisées.

## Définition de terminé

Une fonctionnalité n'est terminée que si parcours normal, erreurs, isolation multi-utilisateur, sécurité, migrations, diagnostics, tests et documentation sont livrés ensemble. Une compilation seule n'est jamais une preuve suffisante.
