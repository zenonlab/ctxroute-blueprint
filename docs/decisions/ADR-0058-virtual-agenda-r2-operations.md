---
scope:
  - apps/extension/runtime/local-agenda-queue*
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

La lecture privée distingue les bornes civiles de la fenêtre et les instants
UTC; elle parcourt les occurrences par pages stables sans tronquer à cent.
Au-delà de 10 000 occurrences, elle échoue explicitement au lieu de présenter
une fenêtre incomplète; le contrat de réponse accepte cette même borne.
WebBridge garde son contrat de cent entrées et 60 Kio; une fenêtre trop grande
renvoie une erreur explicite au lieu de tronquer silencieusement les sorties.
Le cache se lit dans une transaction unique. `local-agenda-queue` sérialise
l'acquisition et l'utilisation d'une génération afin que deux fenêtres ne
projettent pas leurs résultats respectifs. La panne de rafraîchissement public
n'empêche pas l'examen des rappels locaux; leur préférence et la politique de
contenu courante sont revérifiées juste avant l'envoi.

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

Une annonce corrigée remplace l'occurrence de même fournisseur, œuvre, type
et séquence; sans séquence, seul l'identifiant explicite permet ce remplacement.
L'ancienne version reste dans les snapshots R2. Une absence ne retire pas une
annonce du modèle. Seul `CONFIRMED` alimente les observations; une correction
de date pour un même chapitre remplace l'observation précédente. Une séquence
fractionnaire ou suffixée reste textuelle dans l'ancre et le dernier confirmé.

Les lectures v3 privilégient les modèles D1 et gardent le repli historique
lorsqu'aucun modèle ne couvre la fenêtre. v3 et v4 partagent un digest de
génération sur tous les modèles; une modification durant la lecture fait échouer
la page pour permettre une reprise bornée. Chaque ETag dépend de la page et
de ses paramètres, y compris sa fraîcheur. La date de confirmation R2 publiée
reste séparée de la préparation du snapshot suivant et de la modification métier.
La révision du lecteur historique est un SHA-256 borné compatible avec la route.
Les clients doivent comparer les générations entre pages, pas leurs ETag.

La lecture et le passage du temps ne produisent aucune écriture distante. D1
porte la donnée publique courante; R2 porte la reprise et l’historique borné
nécessaire au calcul. Les anciennes générations et pages ne pourront être
supprimées qu’après preuve de bascule et confirmation destructive séparée.
