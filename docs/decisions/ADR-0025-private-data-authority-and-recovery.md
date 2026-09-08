---
scope:
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/architecture/**
  - docs/systems/**
  - docs/workflows/**
  - apps/**
  - packages/**
  - package.json
review: on-change
revised: true
---
# ADR-0025 — Autorités privées et reconstruction

- Status: accepted
- Date: 2026-09-02
- Revised: 2026-09-08

## Contexte

La réécriture avait remplacé la doctrine FavLib de `3267de2` par une autorité
IndexedDB générale et une enveloppe de backup dans sync. Cette divergence
empêchait la reconstruction demandée et confondait présence et persistance.

## Décision

Les favoris navigateur possèdent la présence, le placement et la progression
observée. IndexedDB possède les transactions privées : sources mémorisées,
artefacts, œuvres hydratées, tâches, décisions, agenda et caches. Un retrait
marque une source détachée et retire sa présence active sans supprimer les
œuvres, sources, décisions ou progressions historiques. Une baisse observée
exige confirmation; les observations et saisies humaines gardent leur provenance.

`Work` conserve un ID TobiRink indépendant des favoris et fournisseurs.
`FavoriteSource` porte un lien Work direct et une Review optionnelle.
L'import ne crée pas de Review. Une décision humaine est préservée et protégée
lors des migrations additives, même si son origine historique est incertaine.

`storage.sync` contient uniquement les cinq ensembles d'IDs fournisseurs
triés/dédupliqués et leurs fragments/manifestes versionnés, sans titre, URL,
progression, agenda, décision, secret ou enveloppe de clé. Chaque item est sous
8 192 octets, le total sous 102 400 octets et 512 items. L'ancienne génération
est conservée jusqu'à vérification complète de la suivante. Quotas, concurrence,
digest et cadence suivent le contrat canonique v3.
`storage.local` conserve bootstrap, préférences et appairage/secrets opaques;
les caches techniques existants ne deviennent pas une autorité métier.
Accès réservé au background et aux contextes extension de confiance.

Reset : rescan favoris, lecture sync, hydratation exacte, aliases, parsing,
résolution. Les IDs ne reconstruisent pas tout l'historique privé. Les exports
versionnés et backups chiffrés restent distincts, compatibles et facultatifs.
Le format d'export privé v4 conserve le lien Work direct, le résultat et ses
versions, ainsi que le motif et l'origine d'une Review. Les formats v1, v2 et
v3 restent importables. IndexedDB v9 ajoute l'index `matchedWorkId` des sources;
v10 ajoute deux index multi-entry privés aux fiches Work hydratées : aliases
validés par type/saison et titres fournisseurs. L'export v4 conserve cette
hydratation, son âge et ses aliases privés. Une lecture du cache ne repousse
pas son expiration. Les lignes historiques et leurs liens Review sont conservés.
Les anciennes enveloppes sync ne sont plus produites; leur retrait n'est pas
une suppression automatique. Les formats AES-GCM/PBKDF2 existants restent
inchangés : déchiffrement et validation complète avant remplacement confirmé.

L'Agenda reste local, borné à 100 lignes par période demi-ouverte; une source
résolue est retrouvée par son lien Work, sans exiger une Review artificielle.
Les préférences de notifications et estimations restent explicites. L'organiseur
n'effectue un déplacement qu'après preview confirmé et snapshot vérifié; il ne
recrée ou supprime aucun favori. Son restore ne change pas la doctrine d'autorité.

## Conséquences

Le [plan canonique v3](../systems/favorite-resolution-correction-plan.md) fixe
les migrations et quotas. D1 reste un index optionnel via le Worker seul.
Le site et WebBridge n'accèdent ni à D1, ni aux secrets propriétaire.
Aucune réinitialisation ou migration descendante destructive n'est permise.
