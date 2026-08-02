# Préparation du démarrage de l'implémentation

## État de départ honnête

Le dépôt contient la doctrine, l'architecture, les ADR, les fixtures synthétiques et les scénarios de la Wave 0. Il ne contient encore aucun monorepo, serveur, base, extension ou sauvegarde exécutable. Le futur plan commence donc par la Wave 1 et ne peut revendiquer aucune preuve runtime issue de la documentation.

## Décisions figées avant planification

- produit privé, local, multi-utilisateur et fermé par invitation ;
- favori Chrome comme ancre obligatoire, extension strictement en lecture seule ;
- monorepo pnpm/Turborepo, Node.js 24 LTS ciblé puis revérifié au scaffold ;
- Next.js + shadcn/ui, Fastify + Zod, PostgreSQL + Drizzle, Graphile Worker, WXT MV3 ;
- origine unique `https://favlib.home.arpa` derrière Caddy ;
- authentification et sessions définies par l'[ADR 0014](adr/0014-authentification-et-sessions.md) ;
- cycle de vie et suppression définis par l'[ADR 0015](adr/0015-cycle-de-vie-des-donnees.md) ;
- fournisseurs bloqués par défaut et aucune API nécessaire à la Wave 1 ;
- aucun site réel nécessaire avant sa sous-wave Wave 8.

Une modification de ces décisions pendant l'implémentation met d'abord à jour la doctrine et un ADR. Elle ne doit pas être glissée dans une dépendance ou une migration.

## Prérequis à fournir sur l'hôte

- Docker/Compose et pnpm via Corepack, versions contrôlées par la future commande de diagnostic ;
- entrée DNS locale ou fichier hosts pour `favlib.home.arpa` ;
- espace PostgreSQL et espace temporaire mesurables ;
- destination de sauvegarde chiffrée sur un disque/NAS physiquement distinct ;
- clé de chiffrement de sauvegarde créée et conservée hors de l'hôte ;
- navigateur de test et deux sessions/profils synthétiques Alice/Bob ;
- aucun favori réel, cookie tiers, dump brut ou certificat privé dans le dépôt.

Si le stockage distinct ou l'escrow de clé n'est pas disponible, la Wave 1 peut développer le mécanisme avec une destination jetable mais ne peut pas franchir sa gate de sortie réelle.

## Contrat de configuration à créer en Wave 1

Le scaffold fournit `.env.example` sans secret et une commande de validation échouant au démarrage sur valeur absente, placeholder, origine non HTTPS ou chemin non autorisé.

| Configuration | Forme attendue | Secret | Règle |
|---|---|---:|---|
| `FAVLIB_BASE_URL` | URL HTTPS exacte | non | `https://favlib.home.arpa` par défaut documenté |
| `DATABASE_URL_FILE` | chemin absolu vers secret monté | oui | jamais imprimé ni committé |
| `SESSION_SECRET_FILE` | chemin absolu, valeur aléatoire | oui | rotation documentée, permission fichier minimale |
| `BACKUP_KEY_FILE` | chemin absolu hors volume de backup | oui | absence = backup désactivé et santé en erreur |
| `BACKUP_DESTINATION` | chemin administré explicite | non | refuse racine, home, glob et volume PostgreSQL |
| `FAVLIB_DATA_DIR` | chemin administré explicite | non | dumps temporaires hors Git, quotas contrôlés |
| `TZ` | identifiant IANA | non | stockage UTC, affichage initial `Europe/Paris` |
| `LOG_LEVEL` | enum bornée | non | aucun mode ne journalise secrets/URLs brutes |

Les clés de fournisseurs externes n'apparaissent pas dans la Wave 1. Elles sont ajoutées uniquement avec la politique et la wave qui les consomment.

## Ordre de réalisation recommandé de la Wave 1

1. scaffold minimal, versions exactes, lockfile et commandes racine ;
2. Compose, PostgreSQL, Caddy, healthchecks et démarrage depuis une copie propre ;
3. migrations auth/utilisateurs/sessions/audit/tombstones avec seed synthétique séparé ;
4. bootstrap interactif, invitations, connexion, révocation et rôles ;
5. autorisation serveur et matrice Alice/Bob sur chaque route ;
6. diagnostics, configuration fail-closed et journaux structurés ;
7. commande de backup, chiffrement, rétention et restauration jetable ;
8. exécution de toutes les preuves, checklist manuelle, limites connues et demande de validation utilisateur.

Chaque étape reste intégrable et testée. Les écrans métier, fournisseurs, favoris et connecteurs ne sont pas anticipés dans la Wave 1.

## Définition de prêt d'une tâche

Une tâche n'entre dans le plan actif que si elle possède :

- wave et objectif utilisateur identifiés ;
- dépendances et fichiers probables délimités ;
- invariants de doctrine applicables ;
- parcours normal, erreurs et autorisations attendus ;
- migration/rollback ou justification `N/A` ;
- diagnostics et données sensibles à exclure ;
- tests automatiques et contrôle manuel précis ;
- preuve attendue permettant de la fermer.

Une inconnue de fournisseur ou de site réel devient une tâche de qualification séparée, jamais une hypothèse cachée dans le code.

## Preuves minimales de sortie Wave 1

| Preuve | Artefact attendu |
|---|---|
| copie propre reproductible | commandes documentées et sorties CI/locales conservées dans le registre de wave |
| versions et dépendances | lockfile, inventaire licences et diagnostic runtime |
| isolation | matrice de tests Alice/Bob par endpoint personnel |
| sécurité auth | tests ADR 0014 et inspection des attributs cookie/CSRF |
| migrations | montée depuis base vide et rollback/restauration documentés |
| sauvegarde | manifest, checksum et rapport de restauration sur base neuve |
| exploitation | healthchecks, redémarrage, persistance, copie hors disque et RPO/RTO mesurés |
| validation | limites connues, checklist manuelle et accord utilisateur enregistré avant tag |

## Ce qui ne bloque pas le démarrage

- liste des sites réels, nécessaire seulement avant la Wave 8 ;
- clé Brave ou compte fournisseur ;
- autorisation AniList ou MangaUpdates, tous deux désactivés ;
- dataset catalogue volumineux, traité en Wave 4 ;
- choix de distribution durable de l'extension, dont la décision finale est exigée avant la sortie de la Wave 3.

## Commandes contractuelles après scaffold

```text
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e        # lorsque la wave comporte un parcours E2E
pnpm dev             # développement documenté
pnpm start:local     # pile locale reproductible
pnpm doctor          # versions, config, stockage et santé sans afficher de secret
```

Les noms peuvent être créés exactement ainsi pendant la Wave 1. Toute divergence doit être reportée dans la doctrine et la documentation racine avant validation.
