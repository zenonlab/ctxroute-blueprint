# Validation Wave 1 — socle local

État au 2026-08-02 : implémentation initiale exécutée sur Docker Desktop Apple Silicon.

## Preuves automatisées

- `corepack pnpm install --frozen-lockfile` : dépendances installées avec lockfile.
- `corepack pnpm typecheck` : vert.
- `corepack pnpm test` : vert (8 tests ; intégration PostgreSQL et E2E navigateur encore à activer).
- `corepack pnpm lint` : vert.
- `corepack pnpm --filter @favlib/api build` et `corepack pnpm --filter @favlib/web build` : verts.
- Docker Compose : PostgreSQL 18 healthy, API, Web et Caddy démarrés.
- Smoke HTTP : `/api/v1/health` 200, login Alice, session, logout et invitation administrateur vérifiés.
- Restauration : dump déchiffré et restauré sur PostgreSQL 18 jetable ; `alice@example.test|admin` retrouvé.

## Commandes locales

Après `cp infra/secrets/postgres_password.example infra/secrets/postgres_password`, préparer les fichiers secrets documentés dans `.env.example`, puis lancer `corepack pnpm start:local`. La racine publique Caddy est exportée depuis son volume Docker ; sa clé privée ne doit jamais être exportée.

## Limites honnêtes

Le dump `pg_dump -Fc`, le manifest, le checksum, le chiffrement `age` et la restauration sur base jetable sont vérifiés. La mesure chronométrée RPO 24 h/RTO 4 h reste `NOT_VERIFIED`. Les routes métier hors authentification, utilisateurs, santé et backups sont réservées aux waves suivantes.
