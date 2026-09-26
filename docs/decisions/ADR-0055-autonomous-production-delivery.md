---
scope:
  - .github/workflows/deploy-production.yml
  - apps/provider-gateway/deno.jsonc
  - scripts/infra/cloudflare-driver.mjs
  - scripts/infra/cloudflare-driver.test.mjs
  - scripts/infra/manga-canary.mjs
  - docs/operations/cloudflare.md
  - docs/architecture/src/autonomous-delivery.dataflow.json
  - docs/architecture/src/production-surface.architecture.json
  - docs/architecture/src/production-publication.dataflow.json
review: on-change
revised: true
---

# ADR-0055 — Livraison de production protégée depuis GitHub

- Status: accepted
- Date: 2026-09-19
- Revised: 2026-09-23

## Contexte

Le dépôt possède une application gateway Deno liée à GitHub et un Worker
Cloudflare livré par une gate repository-owned. Une livraison autonome doit
rester bornée aux changements vérifiés et ne doit pas transformer GitHub en
accès général aux ressources Cloudflare.

## Décision

L’application Deno Deploy liée au dépôt construit automatiquement la gateway
sur les changements de `main`. Son répertoire `apps/provider-gateway` reste
configuré dans le tableau de bord Deno, tandis que `deno.jsonc` fixe le runtime
dynamique et `src/index.ts` comme entrypoint.

Un workflow GitHub déclenché par `main` ou manuellement s'exécute uniquement sur
le runner auto-hébergé enregistré avec les labels `self-hosted`, `macOS`,
`ARM64`, `cloudflare-ci`. Il exécute `npm run verify`, génère un plan Cloudflare
expirant, vérifie son digest et applique uniquement
`worker:tobirink-public-api`. Les pull requests n’ont aucun job de déploiement
et le job ne possède que `contents: read`.

Le plan de production encode aussi l’option `preserveRoutes: true`. Wrangler
reçoit une configuration temporaire sans déclaration `routes`, ce qui publie la
nouvelle version et ses déclencheurs sans appeler l’API de routes de zone. La
route `tobirink.com/*` existante reste donc inchangée; cette option ne peut pas
être ajoutée après la création du plan sans invalider son digest.

La preuve `sourceDigest` du plan est calculée sur les entrées réellement livrées
au Worker. Les identifiants de build générés par Next sont remplacés par une
valeur canonique, y compris lorsqu’ils apparaissent dans les métadonnées
`buildId` des sorties HTML/textuelles. Une sortie strictement différente reste
donc détectée, tandis qu’un rebuild équivalent ne déclenche pas à tort
`operation-preview-changed`.

Les secrets `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` sont des secrets
d’environnement GitHub. `PROVIDER_GATEWAY_HMAC_KEY` reste un secret runtime
séparé du dépôt, présent côté Worker et gateway; aucune valeur secrète n’est
versionnée. D1 et les secrets fournisseur ne sont pas mutés par ce workflow.
R2 n'est publié que par l'option manuelle `publish_extension` de l'ADR-0039,
désactivée par défaut, sur `main` avec canaris obligatoires. Son plan distinct
autorise uniquement les deux nouvelles archives, après canaris réussis; les
hashes publics sont vérifiés sans avancer le pointeur Web. Le plan Worker et
son allowlist restent inchangés. Wrangler redéploie les réglages des consommateurs Queue
déclarés dans sa configuration, y compris leur concurrence. L'inspection
Worker inclut donc l'inventaire Queue distant, sans lire D1 ni R2. Le digest
du bundle contient les réglages souhaités; l'inventaire Wrangler ne certifie
ni tous les réglages distants ni le plan tarifaire du compte. Leur validation
opérationnelle reste explicite, sans ajouter une permission Billing.
Les créations/suppressions Queue restent des opérations séparées.
Les canaries et la promotion métier restent des contrôles distincts.
Le workflow propose aussi un input manuel `run_manga_canary`, désactivé par
défaut, conservé comme nom compatible. Il admet maintenant exactement deux
nouvelles clés aléatoires : un anime et un manga publics. Chaque clé doit
d'abord répondre `MISS`, puis l'admission `PENDING`, puis une lecture
`VERIFIED` cohérente avec son média, son titre public et son fournisseur. Un
cache déjà vérifié échoue à la certification. Chaque demande est observée au
plus quarante fois, avec quinze secondes entre lectures; un état terminal
différent ou un `429` interrompt immédiatement sans nouvelle admission.
Cette action ne réarme aucune ligne historique et n'est jamais déclenchée par
un push automatique. La preuve de passage fournisseur complète ces états par
les métriques du consumer; l'absence de métriques reste explicitement absente.

Le packaging construit déjà Chrome et Firefox : la précompilation identique
immédiatement précédente est supprimée du workflow. Les deux builds isolés
de reproductibilité et les builds de la gate performance restent distincts.
Le build Web initial reste nécessaire au serveur statique Playwright. Après
l'installation Chromium, le workflow publie son chemin exécutable dans
`CHROME_BIN` pour que le contrat IndexedDB de `npm run verify` réutilise le
même navigateur au lieu de dépendre d'une installation système implicite.

## Conséquences

Un échec de vérification ou de plan bloque la livraison. Le rollback sélectionne
la révision Deno ou la version Worker précédente via leurs contrôles opérateur,
sans supprimer les données D1, objets R2 ou messages Queue.
## Audit de durcissement — 2026-09-19

Le workflow de production est la barrière obligatoire pour Cloudflare : il ne
s’exécute que sur `main` ou manuellement, attend `npm run verify`, exige un plan
signé et temporaire, refuse toute action autre que
`worker:tobirink-public-api` dans le plan Worker, conserve les routes, puis
supprime le fichier de plan. L'option archives utilise son plan séparé après
canaris. Les actions GitHub v5 sont épinglées aux commits
`fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` pour checkout et
`a0853c24544627f65ddf259abe73b1d18a591444` pour setup-node.

La livraison Deno reste exclusivement assurée par l’application GitHub App
Deno existante. Le dépôt fournit comme preuves le commit `main`, le run de
l’application et la probe publique `/healthz`; il ne prétend pas fabriquer un
journal Deno absent et n’ajoute aucun mécanisme concurrent.

Le contrôle post-déploiement conserve les statuts HTTP et les identifiants
de corrélation; l'option archives ajoute les tailles et SHA-256 publics.
D1, les créations/suppressions Queue et la rotation des secrets restent des
opérations séparées. La publication optionnelle R2 possède son propre plan
borné; le redéploiement des consommateurs est inclus au Worker.
