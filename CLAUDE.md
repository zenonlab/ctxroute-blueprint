# Doctrine FavLib

Ce fichier est la doctrine obligatoire du dépôt. En cas de contradiction, une décision utilisateur explicite plus récente prime et doit être reportée ici et dans un ADR.

## Produit

- FavLib est privé, local et multi-utilisateur.
- Il suit mangas, manhwa, manhua et anime à partir des favoris Chrome/Google.
- Tous les favoris URL sont examinés localement ; seuls les candidats médias nécessaires quittent l'extension.
- AniList enrichit et aide au matching, mais ne bloque jamais une œuvre ou un import.
- PostgreSQL maintient un catalogue canonique local de titres, synonymes, identifiants et relations ; un titre seul n'est jamais une identité unique.
- Une annonce catalogue alimente le calendrier ; seule une origine validée par connecteur affirme qu'une sortie est disponible sur un site.
- FavLib n'héberge, ne télécharge, n'extrait ni ne republie aucun média tiers.
- Aucun contournement d'authentification, paywall, CAPTCHA, DRM ou protection anti-bot.

## Invariants métier

- Le favori établit l'appartenance et la source à surveiller.
- Une origine alternative peut enrichir une œuvre déjà favorite, mais ne crée jamais seule une œuvre, un abonnement ou un favori.
- Le connecteur de la source détecte les sorties disponibles.
- La progression est personnelle et distincte de la disponibilité.
- Une page précise favorite ou une navigation consentie sur la même œuvre peut produire une observation de progression.
- L'extension ne modifie jamais l'arbre des favoris.
- Une régression de progression n'est jamais silencieuse.
- Une sortie spéciale ou d'une autre saison n'est jamais comparée par un simple maximum numérique.
- Une source cassée ne doit jamais être présentée comme une absence de nouveauté.
- Un changement de source ne modifie jamais silencieusement progression, favori ou préférence permanente.

## Multi-utilisateur

- Toute donnée personnelle porte un `user_id` ou est reliée par une contrainte vérifiable à son propriétaire.
- L'autorisation est imposée dans l'API et testée entre Alice et Bob ; un filtre dans l'interface ne constitue pas une protection.
- Les métadonnées et vérifications publiques peuvent être partagées uniquement avec un contexte de collecte identique.
- L'administrateur d'infrastructure local est dans le périmètre de confiance et peut techniquement accéder à la base et aux sauvegardes. L'interface administrateur ne doit toutefois pas exposer les favoris personnels.
- Pas d'inscription publique ; comptes par invitation administrateur.

## Extension et favoris

- Chaque profil Chrome installe et appaire sa propre extension.
- Les IDs Chrome sont qualifiés par `(user_id, installation_id, chrome_bookmark_id)`.
- Snapshot initial, événements idempotents, file hors ligne et réconciliation périodique sont obligatoires.
- Le préfiltrage non-média s'exécute dans l'extension avant envoi à l'API.
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
- La clé de mutualisation inclut connecteur, version, URL canonique, locale, région et mode d'accès.
- Les résultats personnalisés, authentifiés ou dépendants d'une extension ne sont jamais partagés entre utilisateurs.
- Le résolveur multi-source utilise seulement favoris personnels, cibles publiques redécouvrables et catalogues autorisés.
- Les requêtes ont délai, taille, redirections et budget par domaine limités.
- SSRF, DNS rebinding et redirections vers IP privées sont bloqués sauf cible administrée explicitement.

## Données et progression

- La forme source brute d'un numéro est conservée avec sa normalisation.
- L'identité logique d'une sortie inclut œuvre, type, séquence/saison, volume éventuel, numéro/partie et variante spéciale.
- Langue, édition, groupe et URL appartiennent à l'origine de sortie.
- Une fusion entre origines n'est automatique qu'avec une forte confiance ; sinon les sorties restent distinctes.
- La progression avance uniquement dans une même séquence ordonnée et sur une observation à forte confiance.

## Stack arrêtée

- pnpm workspaces + Turborepo.
- Next.js, React, TypeScript, Tailwind CSS et shadcn/ui.
- Fastify, Zod, PostgreSQL et Drizzle ORM.
- WXT Manifest V3 pour l'extension.
- Graphile Worker pour les jobs PostgreSQL ; ne pas ajouter Redis sans ADR.
- Les caches V1 utilisent extension + PostgreSQL + TanStack Query ; aucun média tiers n'est mis en cache.
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
- Ne jamais marquer une wave validée sans preuve de tests et validation utilisateur demandée.
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
