# Validation Wave 3 — appairage et import des favoris

## Build

Depuis la racine :

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm --filter @favlib/extension build
```

Le build WXT produit une cible Chrome MV3 et une cible Firefox. Pour un test local, ouvrir `apps/extension/.output/chrome-mv3` dans `chrome://extensions` avec le mode développeur, puis charger le dossier Firefox dans `about:debugging` → « Extension temporaire ».

## Parcours manuel

1. Installer l’extension dans un profil Chrome et ouvrir le popup. La permission `bookmarks` est expliquée dans Options avant import.
2. Cliquer « Appairer ce profil », se connecter dans FavLib, puis confirmer le code affiché. Le challenge expire après 10 minutes et devient consommé après confirmation.
3. Vérifier l’import initial, puis relancer « Importer maintenant » : aucune seconde ligne ne doit être créée pour le même fingerprint.
4. Couper FavLib, créer/modifier/déplacer/supprimer un favori média, fermer le navigateur, puis rétablir le service. La file locale doit reprendre sans perte. Les URLs et titres non média ne quittent jamais l’extension.
5. Dans Réglages, révoquer l’appareil. Les uploads doivent être refusés ; un nouvel appairage utilise la même installation mais un nouveau jeton.

## Sécurité et limites connues

- Le jeton est opaque, révocable et conservé dans `chrome.storage.local`; ce stockage n’est pas présenté comme chiffré.
- La version de protocole actuelle est `1`. Une version sous le minimum reçoit `426`; la file locale est conservée.
- Les lots sont limités à 250 éléments et le budget interne est inférieur à 5 MiB. Une approche du quota produit un diagnostic `STORAGE_QUOTA_NEAR` plutôt qu’une purge silencieuse.
- La migration atomique de `favlibState` est versionnée. En cas de corruption, une reconstruction peut relire `bookmarks.getTree()` et recréer la file.
- Le serveur ne reçoit que les métadonnées nécessaires à l’identification et à la réconciliation ; ni contenu de page, ni mot de passe, ni session Web.

## Rollback et migration

Appliquer `packages/database/migrations/0002_wave3_extension.sql` après la migration Wave 1. Un rollback applicatif consiste à désactiver le build WXT et à révoquer les appareils depuis FavLib ; ne pas supprimer la file locale. Pour restaurer une base, appliquer les tombstones et révocations Wave 3 avant de remettre l’API en service.
