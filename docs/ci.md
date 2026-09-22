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

La CI ne déploie jamais automatiquement en production. La signature et la
soumission aux stores sont des étapes manuelles approuvées. Cloudflare peut être
inspecté et planifié en CI, mais `apply` exige une approbation explicite sur le
plan exact, l'environnement, le compte et les ressources.

Chaque livraison possède un artefact immuable, un numéro de version, les
résultats des gates, une procédure de rollback vers la version précédente et
une vérification des migrations. Un commit, un tag, une publication ou un
déploiement reste une étape distincte à autoriser.

## Matrice cible

- Linux : gates complètes, Chromium, Worker et génération d'artefacts.
- macOS : validation du package et parcours Chromium représentatifs.
- Firefox : packaging WXT et smoke via `web-ext`; parcours étendus dès que le
  runner automatisé est stabilisé.
- Windows : compilation, types, tests unitaires et validation des artefacts.

Le pipeline existant du blueprint reste actif pendant l'initialisation. Les
jobs produit seront ajoutés seulement avec les commandes réellement
implémentées et approuvées.

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
## Diagnostic Discovery agrégé

Avant le plan Cloudflare, la CI protégée exécute `scripts/infra/public-discovery-diagnostics.mjs` en lecture seule. Le rapport ne contient que des comptes D1 par état, motif, âge `PENDING` et état de signal Queue, ainsi que les métadonnées `rows_read` et `rows_written` lorsque l’API les retourne. Il exclut titres, URLs, clés, profils et identifiants d’installation. Les compteurs Chromium isolés, les `429` Worker et les délais fournisseur ne sont pas conservés dans D1 : ils restent des mesures de canari distinctes, et une valeur absente est explicitement signalée plutôt que déduite.
