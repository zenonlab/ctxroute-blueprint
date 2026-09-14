---
scope:
  - packages/application/src/recovery/**
  - packages/adapters-browser/src/recovery/**
  - packages/adapters-indexeddb/src/recovery/**
  - packages/adapters-indexeddb/src/database.ts
  - apps/extension/runtime/private-recovery-messages.ts
  - apps/extension/runtime/use-private-recovery.ts
  - apps/extension/entrypoints/options/PrivateRecovery/**
  - apps/extension/wxt-entrypoints/background.ts
  - docs/systems/favorite-resolution-rebuild-pipeline.md
  - docs/architecture/src/favorite-resolution.dataflow.json
  - docs/architecture/src/favorite-resolution.lifecycle.json
review: on-change
revised: true
---

# ADR-0044 — Sauvegarde locale chiffrée de l’état privé

- Status: accepted
- Date: 2026-09-12

## Contexte

`storage.sync` restaure uniquement les identifiants fournisseurs et leurs
associations publiques. Il ne doit pas contenir les titres, URL, dossiers,
progressions, Reviews ou secrets. Une désinstallation efface aussi
`storage.local`; la seule synchronisation d’identités ne peut donc pas restaurer
l’historique privé.

## Décision

Les Réglages proposent un export et une restauration de fichier locaux. La
version 5 de l’export privé contient les Works, bibliothèques, progressions,
agenda, rappels, Reviews, sources favorites et organisation. Les anciennes
archives des versions 1 à 5 restent importables; tout ancien champ Collectif
est accepté pour compatibilité de lecture, puis ignoré et jamais réinstallé.

L’extension chiffre l’export complet avec AES-GCM-256. Une clé de données
aléatoire chiffre le contenu; PBKDF2-SHA-256 à 310 000 itérations dérive une clé
d’enveloppe depuis une phrase de 12 à 1 024 caractères. La phrase n’est ni
stockée ni envoyée. Le message interne est réservé à la page Options, le blob
est limité à 18 Mio et le texte chiffré à 16 Mio.

La restauration déchiffre, parse et valide toutes les références avant la
première mutation. Dexie remplace les huit agrégats restaurables dans une seule
transaction et efface les checkpoints, tâches et artefacts dérivés afin que la
réconciliation les reconstruise. IndexedDB garantit l’atomicité de ce
remplacement; aucun journal externe ou état owner n’est nécessaire. Aucun
secret ou état Collectif historique n’est restauré dans `storage.local`.

L’import exige l’action explicite `replace-private-state`. Une phrase erronée,
un ciphertext altéré, une référence orpheline ou une erreur d’écriture ne
modifie pas les stores autoritatifs. Aucun endpoint Worker, D1 ou R2 n’est ajouté
pour cette archive.

## Conséquences

L’utilisateur peut conserver son historique entre désinstallations sans ouvrir
une nouvelle frontière cloud. La sécurité de récupération dépend de la phrase
choisie et de la conservation du fichier. Les snapshots synchronisés continuent
de couvrir la reconstruction légère des seules identités publiques.
