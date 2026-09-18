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
- Revised: 2026-09-19

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

La reprise utilise `agenda-operations/v2` avec lecture de repli vers `v1`;
aucun objet historique n'est modifié ni supprimé pendant cette transition.
L'identité de collecte survit au remplacement du jeton de bail. Chaque page
est immuable et son numéro, sa clé et son SHA-256 sont référencés dans le
checkpoint conditionnel. Une page écrite avant interruption sans checkpoint
reste sans référence et peut être recollectée; une page validée se relit
indépendamment de son ancien jeton. L'horloge est revérifiée avant avancement.
Un retour R2 `null` est un conflit, jamais un succès. Une panne réseau reste
une erreur; un bail vivant impose une reprise à son échéance.

La lane distingue `collecting`, `ready` et `published`. Le snapshot prêt et
son digest restent durables avant D1; seul le succès D1 autorise la confirmation
R2 et le changement du pointeur actif. Une interruption après commit D1 rejoue
la comparaison sémantique puis confirme R2 sans réécrire le contenu métier.
Le contrôle de qualité MangaUpdates précède le checkpoint terminal, pour
qu'une réponse rejetée ne devienne jamais publiable lors d'une reprise.

Le pointeur `pending.json` conserve au plus 104 sessions non terminées, sans
éviction silencieuse. Les anciens signaux sont raccordés par lots de vingt
avec curseur durable. Le cron hebdomadaire et le consumer Queue vérifient ce
pointeur; une réservation conditionnelle limite la réémission à une fois par
minute. Aucun cron supplémentaire n'est créé. Si tout envoi échoue sans aucun
traitement ultérieur, la reprise attend le dimanche suivant ou le signal
opérationnel authentifié `agenda-recovery`. Cette opération ne réarme aucune
demande Discovery et ne purge aucune donnée.

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
