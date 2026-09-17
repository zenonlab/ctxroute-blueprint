---
scope:
  - apps/worker/migrations/**
  - apps/worker/src/releases/**
  - apps/worker/src/native-collectors.ts
  - packages/domain/src/manga-prediction.ts
  - packages/application/src/agenda/**
  - packages/application/src/releases/**
  - packages/adapters-cloudflare/src/releases/**
  - docs/architecture/src/adaptive-public-refresh.dataflow.json
review: on-change
revised: true
---

# ADR-0058 — Agenda virtuel et opérations R2

- Status: accepted
- Date: 2026-09-17

## Contexte

L’Agenda matérialise chaque occurrence, ses pages fournisseur, une génération
JSON et une projection SQL. Le déplacement de la fenêtre produit donc des
écritures même quand la cadence d’une œuvre n’a pas changé.

## Décision

Conserver dans D1 un modèle courant compact par œuvre canonique : ancre civile,
intervalle éventuellement calculé, prochaine date fournisseur explicite,
exceptions bornées, validité, état éditorial et provenance. Comparer la forme
sémantique avant mise à jour. Les anciennes tables restent lisibles pendant la
bascule, mais ne sont plus l’autorité de `/v3/releases` après activation du
nouveau lecteur.

Projeter localement seulement la fenêtre demandée. Une date explicite prime sur
une estimation. Une estimation issue du prédicteur manga existant produit au
plus la prochaine occurrence; elle n’est jamais réutilisée comme observation.
Les états terminé, annulé et hiatus suspendent les prévisions. Les dates civiles
restent des dates sans heure inventée et les séquences textuelles restent
textuelles.

Stocker dans R2 les observations et états de travail sous des clés versionnées.
Chaque objet porte un jeton propriétaire, une échéance et une version; les
écritures utilisent les préconditions ETag. Les observations sont dédupliquées
et limitées aux douze plus récentes par œuvre. Les objets temporaires expirent
logiquement après sept jours; l’actif et deux versions précédentes restent
référencés avant toute collecte des orphelins.

Publier un pointeur seulement après l’écriture et la relecture de l’objet
complet. Un échec Queue laisse le travail récupérable; un doublon ne republie
pas un modèle identique. `/v4/release-models` expose les modèles bornés et
paginés aux nouvelles extensions, qui calculent localement leur fenêtre;
`/v3/releases` continue de projeter côté Worker pour les anciennes versions.

## Conséquences

La lecture et le passage du temps ne produisent aucune écriture distante. D1
porte la donnée publique courante; R2 porte la reprise et l’historique borné
nécessaire au calcul. Les anciennes générations et pages ne pourront être
supprimées qu’après preuve de bascule et confirmation destructive séparée.
