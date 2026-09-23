# CI/CD Tobirink

## Validation continue

La CI utilise des dépendances verrouillées et des permissions minimales. Elle
valide d'abord le contrôle du dépôt, puis les frontières d'import, les types,
les tests unitaires, les contrats, les migrations, les interfaces React, les
packages Chrome et Firefox, les parcours Playwright et les tests Worker sous
`workerd` lorsqu'ils existent.

Les artefacts autorisés sont les packages d'extension non signés, les rapports
de test expurgés, les budgets de bundle et les diagrammes Archify. Aucun secret,
profil navigateur réel, bibliothèque utilisateur ou chemin local sensible ne
doit être publié.

## Livraison

La CI protégée déploie automatiquement le Worker depuis `main` après les gates
du dépôt et la vérification du plan Cloudflare exact, décrit plus bas. La
signature et la soumission aux stores restent des étapes distinctes. Une
mutation directe de production hors de ce workflow exige la confirmation
immédiate de son plan, de son compte et de ses ressources.

Chaque livraison possède un artefact immuable, un numéro de version, les
résultats des gates, une procédure de rollback vers la version précédente et
une vérification des migrations. Les commits et push vérifiés sont couverts par
le plan de développement autonome approuvé; ils ne donnent pas une autorisation
générale pour les mutations de production hors workflow.

## Matrice cible

- Linux : gates complètes, Chromium, Worker et génération d'artefacts.
- macOS : validation du package et parcours Chromium représentatifs.
- Firefox : packaging WXT et smoke via `web-ext`; parcours étendus dès que le
  runner automatisé est stabilisé.
- Windows : compilation, types, tests unitaires et validation des artefacts.

La matrice ci-dessus est une cible, pas une attestation de couverture : le
workflow actuel utilise le runner macOS ARM64 enregistré. Les gates locales
inspectent le dépôt courant; les copies de travail sous `/.worktrees/` sont
exclues via Git sans être supprimées. Les sources hors des racines déclarées
restent rejetées, avec un test de non-régression dédié.

## Migration du plan de contrôle

La révision de migration du blueprint est épinglée à
`abd9d8e67d9a525998a769e6d260629614fb63f3`. La migration utilise l'historique
Git existant ; elle ne réinstalle pas le template et ne remplace pas les
documents produit.

Avant la fusion, l'inventaire distingue trois catégories :

- contrôleur amont à adopter : Progress, dashboard, MCP, hooks et tests ciblés ;
- état Tobirink à préserver : configuration initialisée, ADR, diagrammes produit,
  contrats UI et historique de progression ;
- fichiers mixtes à résoudre manuellement : `project-config`, Progress, contrats
  initialisés et tests d'initialisation.

Après chaque étape approuvée, exécuter les validations ciblées avant le commit.
La gate finale est `npm run verify`. Elle doit notamment confirmer les schémas,
le MCP Progress, les hooks, les diagrammes internes et produit, le Sensor, les
tests et l'absence de diff mal formé. Aucun déploiement ou nettoyage ne fait
partie de cette migration.
## Livraison autonome de production

Le workflow `.github/workflows/deploy-production.yml` se déclenche uniquement
sur `main` ou par `workflow_dispatch`. Le job exige `npm run verify`, produit un
plan Cloudflare temporaire signé, vérifie qu’il contient exactement
`worker:tobirink-public-api` avec `preserveRoutes=true`, puis applique uniquement
cette cible.

Le workflow utilise `actions/checkout@v5` et `actions/setup-node@v5`, qui
reposent sur le runtime Node maintenu de leurs actions. Le plan est supprimé en
fin de job et aucun secret n’est écrit dans les logs ou les artefacts.

Après l’application, le job vérifie silencieusement `/`, `/library` et le
`/healthz` public de la gateway Deno. Seuls le statut HTTP et un identifiant de
corrélation présent dans les en-têtes sont affichés.

La gateway Deno reste déployée par l’application GitHub App Deno existante,
depuis `apps/provider-gateway` sur les commits `main`. Le workflow Cloudflare
ne crée pas de second déploiement Deno et ne possède aucun secret Deno.

Le packaging produit lui-même les deux builds extension; aucune précompilation
identique n'est nécessaire juste avant. Les builds isolés testent une autre
propriété (reproductibilité) et restent obligatoires. L'input historique
`run_manga_canary` exécute désormais deux admissions neuves, anime et manga,
avec preuve `MISS → PENDING → VERIFIED`, au plus quarante lectures par média.
Il refuse le cache chaud et n'effectue aucun réarmement historique.

L'option `--observe` utilise le jeton Cloudflare existant uniquement dans cette
étape protégée pour observer `worker.cost`. Elle publie les compteurs agrégés de
la fenêtre Discovery, jamais les événements bruts. Une fenêtre sans événement
ou sans appel fournisseur échoue : un `VERIFIED` seul ne certifie pas le passage
fournisseur. La fenêtre est bornée à vingt-quatre minutes et le processus
d'observation est arrêté à la sortie. Ces totaux peuvent inclure d'autres
demandes concurrentes ; ils ne constituent pas une attribution par œuvre.

## Diagnostic Discovery agrégé

Avant le plan Cloudflare, la CI protégée exécute
`scripts/infra/public-discovery-diagnostics.mjs` en lecture seule. Le rapport v2
sépare média, état, motif et signal Queue. L'âge `PENDING` est calculé depuis
`created_at`; l'échéance `retry_at` constitue un groupe distinct. Les deux
utilisent une comparaison temporelle SQLite, et non une comparaison lexicale
entre les formats ISO et SQL. Une requête échouée ou invalide fait échouer la
gate sans exposer son erreur brute.

Les métadonnées `rows_read` et `rows_written` ne mesurent que ces quatre requêtes
de diagnostic, jamais le coût total du consumer. Titres, URLs, clés, profils et
identifiants d'installation sont exclus. Les compteurs Chromium isolés, les
`429` Worker et les délais fournisseur ne sont pas conservés dans D1 : ils
restent des mesures de canari distinctes, et une valeur absente est signalée
plutôt que déduite. Les tests exécutent les agrégats sur SQLite avec deux médias,
un arriéré ancien déjà dû, une demande récente différée et la borne inclusive.
