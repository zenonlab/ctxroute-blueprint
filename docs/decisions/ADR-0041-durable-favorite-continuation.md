---
scope:
  - apps/extension/runtime/favorite-resolution-continuation.ts
  - apps/extension/runtime/favorite-resolution-runtime.ts
  - apps/extension/wxt-entrypoints/background.ts
  - docs/systems/favorite-resolution-rebuild-pipeline.md
  - docs/architecture/src/favorite-resolution.dataflow.json
  - docs/architecture/src/favorite-resolution.lifecycle.json
review: on-change
revised: true
---

# ADR-0041 — Reprise durable de la résolution des favoris

- Status: accepted
- Date: 2026-09-12

## Context

Un réveil MV3 limite volontairement l’inventaire à huit lots de 100 favoris et
la résolution à 100 tâches ou 20 secondes. Le checkpoint restait actif après le
800e favori, mais la fin du réveil était diagnostiquée comme terminée. La seule
reprise périodique était partagée avec les notifications et ne matérialisait pas
le travail restant.

## Decision

Le runtime partage huit unités de travail par réveil entre deux phases locales.
La phase `inventory` lit et importe des lots de 100 favoris. Son dernier lot
écrit un checkpoint `presence`, jamais un faux état complet. La phase `presence`
reclasse au plus 100 sources par transaction. Chaque page et son curseur sont
écrits dans la même transaction IndexedDB; seule la transaction de la dernière
page écrit `complete`. Une interruption rejoue donc au plus une page de manière
idempotente. Les checkpoints actifs historiques sans phase reprennent comme
`inventory`.

La prélecture des identités est bornée à une seule page de cinquante sources
par réveil. Deux prélectures successives pouvaient épuiser le budget avant
l’admission; les tâches doivent conserver une possibilité effective d’émission.
Le timeout HTTP est adapté au temps restant, plafonné à quinze secondes.
Sous une seconde restante, la requête est différée sans tentative consommée.

Une tranche de résolution réclame les tâches par groupes de quatre puis traite
ces claims indépendants avec un pool fixe. Les écritures de chaque tâche restent
transactionnelles; aucun provider n'est appelé au-delà de ses limites et une
erreur d'un worker est persistée et tracée individuellement.

Le runtime demande une continuation immédiate quand une des deux phases reste
active, quand la résolution a consommé la limite de 100 tâches ou quand un appel
fournisseur a épuisé le budget de 20 secondes. Un checkpoint complet reste
stable entre les réveils fournisseurs. L’installation, la mise à jour, le
démarrage du navigateur et une mutation des favoris imposent un nouveau parcours
de l’autorité navigateur. L’action Options reprend une phase active; après
convergence, elle lance volontairement une nouvelle vérification.

La même alarme reprend ensuite un checkpoint versionné de maintenance du cache
public. Une page inspecte au plus cinquante sources et conserve son dernier
identifiant avant suspension. Un cycle complet attend vingt-quatre heures; une
page restante demande une continuation immédiate. Le budget de réhydratation
est indépendant : vingt œuvres échues au plus par réveil, même si davantage de
fiches sont lues dans le lot.

Après chaque passage, l’outbox calcule la prochaine tâche exécutable par trois
lectures bornées de ses index composés : READY, RETRY_AT et claim expiré. Le
background matérialise cette échéance par une alarme MV3 ponctuelle nommée à la
date exacte, avec le plancher navigateur de 30 secondes. Il efface l’alarme si
aucune tâche ne reste. Recréer le même nom remplace l’alarme existante et
empêche leur multiplication. L’alarme relance le runtime idempotent depuis les
états IndexedDB; le commit de résolution met à jour la projection locale dans
la même transaction. La réparation globale reste réservée à l'installation,
la restauration, l'audit périodique et aux demandes explicites (ADR-0042).
À chaque évaluation du service
worker, le background relit le checkpoint et l’échéance de l’outbox puis restaure
l’alarme nommée. L’alarme périodique des notifications sert de contrôle de
présence : elle réarme cette échéance si le navigateur a perdu l’alarme, sans
lancer elle-même un scan de favoris ni un appel fournisseur.

Le contrôleur expose des états opérationnels distincts pour l’inventaire, la
résolution immédiatement exécutable, l’attente d’une échéance fournisseur, la
pause, le blocage après limite et la convergence. `retryable` reste un résultat
de source et ne sert plus à nommer un lot d’inventaire incomplet.

La page Options relit automatiquement cet état pendant un parcours actif et au
retour de visibilité. Une lecture reste sans effet fournisseur. Elle peut
réarmer une alarme absente ou dépassée à partir du checkpoint et de l’outbox,
sans recommencer l’inventaire. Le background effectue le même contrôle à son
évaluation et par l’alarme périodique existante.

Le debug de pipeline est un observateur optionnel et booléen. Quand il est
activé, le runner enregistre uniquement l’opération, l’état, un code fermé et
une durée bornée pour l’admission, l’attente distante et le commit. Il ne
contient ni titre, URL, dossier, payload, secret ou identifiant fournisseur.
Quand il est désactivé, l’observateur est court-circuité et le flux métier reste
identique.

Après huit échecs automatiques d’une même tâche, le runner la place en
`BLOCKED/AUTOMATIC_ATTEMPT_LIMIT`. Aucune nouvelle alarme n’est programmée pour
elle. Une action explicite la remet à zéro et la réenfile. La pause persistée
termine le claim courant, efface l’alarme puis interdit tout nouveau claim; la
reprise conserve les sources, artefacts, décisions et œuvres.

## Consequences

Une bibliothèque supérieure à 800 favoris converge sur plusieurs réveils sans
garder le service worker vivant. Après sa validation, l’inventaire n’est plus
rescanné pour attendre un fournisseur. Les retries et claims expirés sont repris
à leur propre échéance par lectures indexées bornées. Le contrôle périodique ne
fait que restaurer l’alarme ponctuelle perdue. Options présente les quatre étapes,
la phase courante, la prochaine reprise automatique, la pause et le déblocage. Aucun
nouveau stockage, réseau, accès D1 ou permission navigateur n’est ajouté.
