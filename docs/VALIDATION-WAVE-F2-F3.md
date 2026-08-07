# Validation Wave F2/F3 — responsabilités fournisseurs et couvertures

## Périmètre livré

- AniList est utilisé pour l’identité et les métadonnées des anime uniquement.
- MangaUpdates est utilisé pour l’identité des manga, manhwa et manhua.
- AniList fournit une couverture de lecture uniquement après résolution et correspondance fiable.
- AniList peut fournir une image fallback pour une œuvre de lecture déjà résolue par MangaUpdates.
- Les anciennes identités AniList de lecture sont conservées comme provenance historique et ne sont pas supprimées destructivement.
- Le diagnostic expose les identités par fournisseur, les couvertures manquantes et leur liste détaillée.

## Reprise

Les œuvres de lecture favorites sans identifiant MangaUpdates sont ré-enqueueées par la clé idempotente `repair-mu:<mediaId>:<fingerprint>`. La progression, les favoris et les liens existants restent inchangés.

## Gates automatiques

```bash
corepack pnpm typecheck
corepack pnpm --filter @favlib/metadata test -- --run
corepack pnpm --filter @favlib/worker test -- --run
corepack pnpm --filter @favlib/api typecheck
git diff --check
```

## Diagnostic couverture

```text
GET /api/v1/extension/diagnostic/covers-missing
```

La réponse contient `count` et, pour chaque œuvre, `mediaId`, `type` et les titres connus. Cet endpoint est read-only et ne supprime ni identité, ni favori, ni progression.

## Limite explicitement reportée

La classification `UNKNOWN` et la détection sémantique du contenu réel d’une page (vidéo contre pages d’un lecteur) restent dans la wave suivante. Une URL ambiguë ne doit pas être traitée comme preuve d’identité fournisseur.
