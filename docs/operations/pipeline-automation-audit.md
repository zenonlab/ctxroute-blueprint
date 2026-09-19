# Audit de l'automatisation — 19 septembre 2026

## Verdict et périmètre

La version 1.0.39 est livrée, mais la pipeline ne mérite pas une certification
« 100 % automatique ». La séparation D1/public et IndexedDB/privé est adaptée;
les corrections R2 constituent un progrès réel. Des défauts de raccordement,
de compatibilité et de notifications subsistent malgré une vérification verte.
Le précédent compte rendu de livraison ne prouve donc pas la fiabilité complète.

Audit du commit `4ca6f7a`, du parcours favoris → parsing → Discovery → Queue →
fournisseurs → D1/R2 → extension → Agenda/notifications, des contrats publics,
des tests, du packaging et des documents opérationnels. L'audit ne modifie
aucun comportement produit, secret ou ressource distante. Les constats de code
ci-dessous sont issus de lectures des branches exécutées; ils ne sont pas
présentés comme des incidents reproduits sur le profil personnel.

`npm run verify` a été réexécuté avec succès : Worker 132 tests, extension 150,
application 399, adaptateur navigateur 99, contrats 14, domaine 37,
Public Discovery 63, UI 129. Le corpus parser passe 11 tests; un oracle externe
reste ignoré. Le contrat IndexedDB passe sur Chromium : 500 œuvres en 16 ms,
1400 favoris mixtes en 54,1 ms. Archify, lint, typechecks, audit des dépendances,
builds et validations documentaires passent. Ces résultats couvrent les
assertions existantes, pas les défauts identifiés dans cet audit.

La lecture publique `/v4/release-models` pour le 19 septembre au 4 octobre
retourne toujours `models: []`, une révision `models-e3b0…` et
`generatedAt: 1970-01-01T00:00:00.000Z`. L'inspection administrative échoue à
nouveau sur `wrangler queues list` avec `No API token found`. La dernière
preuve de déploiement reste celle du runbook; les baux, le backlog, la DLQ,
les compteurs et les snapshots distants n'ont pas été inspectés dans cet audit.

## Défauts prioritaires

Corrections locales en cours, distinctes de la version livrée : A02, A03, A04,
A08 et A11 sont couverts par les tests de périodes Paris/New York, 205
occurrences, rappels après erreur publique, préférence adulte avant émission,
lecture IndexedDB concurrente et sérialisation de trois fenêtres. Les tests
ne certifient pas le profil personnel ni un nouveau déploiement. Les autres
constats ci-dessous restent à traiter.

### A01 — P1 : activation du lecteur avant disponibilité des modèles

Le lecteur installé demande exclusivement v4. Il refuse une génération âgée
de huit jours, donc la réponse publique datée de 1970. Un nouveau profil sans
cache obtient une erreur Agenda, alors que v3 possède des données historiques.
La publication des ZIP et un HTTP 200 ne certifient pas ce parcours.

Sources : [loader](../../packages/adapters-browser/src/releases/http-public-release-loader.ts),
[lecteur D1](../../apps/worker/src/releases/public-release-calendar.ts),
[runbook](cloudflare.md).

Correction : préparer une bascule vérifiée des œuvres déjà canoniques, ou un
repli historique borné dans le client sans promouvoir d'identité non vérifiée.
Test exigé : archive neuve, D1 modèles vide, historique disponible, Agenda
effectivement affiché; puis bascule après publication réelle.

### A02 — P1 : fin de semaine perdue dans les fuseaux positifs

L'UI convertit les bornes de minuit local en instants UTC. Le background puis
`readLocalReleaseAgenda` prennent `slice(0, 10)` et interrogent un intervalle
civil dont la borne supérieure est exclusive. À Paris, la semaine locale du
21 au 28 septembre devient du 20 au 27 septembre : le dimanche 27 est exclu.
Le tri et le filtrage visuel ne peuvent pas recréer les événements non lus.

Sources : [période UI](../../packages/ui/src/features/agenda/agenda-period-model.ts),
[background](../../apps/extension/wxt-entrypoints/background.ts),
[lecture locale](../../packages/application/src/agenda/local-release-agenda.ts).

Correction : transporter séparément les bornes civiles et les bornes instants;
filtrer les DATE et INSTANT selon leurs propres contrats. Tester UTC, Paris,
un fuseau négatif et les deux transitions d'heure sur le raccordement complet.

### A03 — P1 : une panne publique arrête les rappels locaux

`resumeNotifications` attend `refreshPublicReleases` avant de drainer les tâches.
Si la requête échoue sans cache recevable, aucun rappel local n'est examiné.
Les gestionnaires d'alarmes absorbent ensuite l'erreur. Cela contredit le
principe « la panne publique ne bloque pas les fonctions locales ».

Source : [background, resumeNotifications](../../apps/extension/wxt-entrypoints/background.ts).

Correction : dissocier acquisition publique, invalidation et exécution locale;
définir explicitement quelles annonces périmées sont encore notifiables.
Test : rappel local valide + API 503/cache absent, puis réveil MV3.

### A04 — P1 : politique de contenu absente à l'envoi d'une tâche existante

La programmation filtre les œuvres selon `showAdultContent`, mais le drain ne
vérifie que `nativeNotifications`. `resumeDueAgendaNotification` relit entrée
et rappel, sans relire la classification de l'œuvre. Une tâche créée quand
l'affichage adulte était autorisé peut donc être publiée après sa désactivation.

Sources : [drain](../../apps/extension/runtime/local-notification-runtime.ts),
[envoi](../../packages/application/src/agenda/agenda-notifications.ts).

Correction : réappliquer la politique courante juste avant l'effet externe,
sans supprimer l'œuvre ni le choix du rappel. Tester ON → tâche → OFF → réveil.

### A05 — P1 : annulations testées, mais pas acquises par les collecteurs

AniList construit exclusivement des événements `SCHEDULED`; MangaUpdates
construit `CONFIRMED`. Le schéma admet `CANCELLED`, mais les deux producteurs
Agenda actuels ne l'émettent jamais. La projection conserve les annonces
explicites même pour un modèle dont le statut est CANCELLED ou HIATUS; ces
statuts suspendent les estimations seulement. Les fixtures d'annulation prouvent
le traitement d'une preuve reçue, pas sa réception automatique.

Sources : [collecteurs](../../packages/public-discovery/src/agenda/collectors.ts),
[pages fournisseur](../../packages/public-discovery/src/agenda/provider-pages.ts),
[projection](../../packages/application/src/agenda/project-virtual-agenda.ts).

Correction : définir et raccorder une preuve fournisseur explicite par occurrence,
ou exposer clairement une information indisponible. Ne jamais transformer une
absence de page en annulation. Tester depuis la réponse fournisseur brute.

### A06 — P1 : rupture du lecteur v4 1.0.38 sur plusieurs pages

Le serveur produit maintenant des ETags différents par représentation. Le
lecteur livré en 1.0.38 exige leur égalité entre pages. Le correctif client
1.0.39 résout ce défaut pour les utilisateurs mis à jour seulement. La livraison
de ZIP n'est pas une preuve de mise à jour automatique des installations.

Sources : [routes](../../apps/worker/src/releases/public-release-routes.ts),
historique Git du loader avant `540435b`, [runbook](cloudflare.md).

Correction : définir une transition négociée/versionnée ou une politique de
mise à jour effectivement assurée. Gate exigée : ancienne archive installée
contre nouveau Worker avec plus de cent modèles, en plus de la nouvelle archive.

### A07 — P1 : bascule v3 partielle et limite dure à mille modèles

Dès qu'une requête trouve un modèle D1, v3 projette seulement les modèles et
ne consulte plus l'historique R2/D1 des autres œuvres. Une bascule partielle
peut ainsi faire disparaître des annonces historiques non encore modélisées.
Au-delà de mille modèles dans la fenêtre, la route lève une erreur au lieu
de paginer. Ce seuil ne mesure pas le nombre de favoris privés : c'est le
catalogue public partagé.

Source : [query, modelRows et LIMIT 1001](../../apps/worker/src/releases/public-release-calendar.ts).

Correction : gate de couverture avant activation ou fusion historique contrôlée,
puis pagination bornée sans rupture globale. Tester couverture partielle et
1001 modèles canoniques dans la même fenêtre.

### A08 — P2 : cent occurrences locales, puis troncature silencieuse

La lecture et le chemin « projection déjà courante » demandent exactement cent
événements sans curseur ni indicateur d'incomplétude. Une période plus chargée
ne peut pas être entièrement affichée; les rappels réévalués sont aussi limités.
Une borne de ressources est utile, une perte silencieuse ne l'est pas.

Sources : [lecture/projection](../../packages/application/src/agenda/local-release-agenda.ts),
[adaptateur](../../packages/adapters-indexeddb/src/releases/dexie-local-release-agenda.ts).

Correction : pages/checkpoint ou contrat explicite d'incomplétude, avec test
de 101 événements appartenant à des œuvres présentes.

### A09 — P2 : deux formes du profil canonique peuvent diverger

L'upsert remplace `profile_json` par la réponse reçue, mais conserve les anciennes
colonnes métier avec `COALESCE` lorsque des champs sont absents. Par exemple,
un statut ou total omis disparaît du JSON tout en restant dans la colonne.
Le modèle est ensuite aligné sur `candidate.editorialStatus ?? 'UNKNOWN'`.
La lecture publique sert directement le JSON. Les dernières sorties confirmées
sont mises à jour dans les colonnes par Agenda sans être ajoutées au profil servi.

Sources : [metadataProfile et catalogueStatements](../../packages/adapters-cloudflare/src/catalogue/d1-public-discovery-v3-adapter.ts),
[publication Agenda](../../apps/worker/src/releases/public-release-collectors.ts).

Correction : construire un profil normalisé unique avec sémantique explicite
« absent / inconnu / supprimé », puis en dériver colonnes, modèle et contrat
public dans la même transaction. Tester une réponse fournisseur partielle et
une lecture via un autre alias.

## Performance, concurrence et exploitation

### A10 — P2 : génération globale recalculée pour chaque page

`modelGeneration` parcourt et concatène tout le catalogue; v4 l'appelle deux
fois par page, avec lecture des deux lanes R2 à chaque appel. Pour N modèles
et P pages, le travail de synthèse est de l'ordre de N × P. Le chemin v3
reprojette également tous les modèles de la fenêtre pour chaque page.

Source : [lecteur D1](../../apps/worker/src/releases/public-release-calendar.ts).

Amélioration : une révision de génération durable publiée avec les changements,
une fraîcheur distincte et des pages indexées. Mesurer les lignes réellement
lues; ne pas remplacer cette preuve par le seul temps d'un petit test.

### A11 — P2, risque de concurrence : cache global lu en deux transactions

`load()` lit l'état actif puis les événements hors transaction commune; une
sauvegarde concurrente peut intercaler deux générations. Dans le background,
plusieurs attentes du même `releaseRefreshInFlight` peuvent chacune lancer une
nouvelle requête après sa résolution. Une période peut alors projeter le cache
qu'une autre période vient de remplacer. Le défaut structurel est présent;
l'entrelacement exact reste à reproduire par test déterministe.

Sources : [cache](../../packages/adapters-indexeddb/src/releases/dexie-public-release-generation-cache.ts),
[refreshPublicReleases](../../apps/extension/wxt-entrypoints/background.ts).

Correction : lecture transactionnelle cohérente, file de rafraîchissement et
projection du snapshot reçu par l'appel concerné. Tester deux fenêtres et trois
demandeurs, avec suspensions imposées entre lecture d'état et lecture d'événements.

### A12 — P2 : coûts de reprise partiellement invisibles

`processAgendaQueue` instrumente son bucket, mais `recoverPendingAgenda` et
`enqueueAgendaRefresh` reconstruisent un store sur le bucket brut. La reprise
est appelée dans le traitement puis à la fin du batch. Ses lectures, listes,
CAS et émissions Queue ne sont pas intégralement comptabilisées dans le
diagnostic de collecte. Les chiffres du runbook sont des fixtures, pas un
budget total de production.

Sources : [collecteurs natifs](../../apps/worker/src/native-collectors.ts),
[métriques](../../apps/worker/src/operational-metrics.ts),
[entrée Queue](../../apps/worker/src/index.ts).

Correction : instrumentation au niveau du réveil complet, compteurs d'envoi
Queue et événements d'échec de reprise, sans contenu privé. Ne pas changer les
quotas avant d'avoir ces mesures.

### A13 — P2 : l'automatisation est volontairement conditionnelle

Si un signal R2 est conservé mais aucun envoi Queue ni traitement ultérieur ne
réussit, la reprise attend le cron hebdomadaire ou une intervention contrôlée.
Un backlog ancien est prioritaire. Les FAILED serveur, BLOCKED locaux,
ambiguïtés et décisions humaines ne sont pas réarmés arbitrairement : c'est
une protection requise, pas un défaut à supprimer pour afficher « automatique ».
Il manque une preuve opérationnelle récente de backlog/DLQ et une alerte
automatique testée qui évite de découvrir un blocage en ouvrant l'extension.

Sources : [pending/recovery](../../packages/adapters-cloudflare/src/releases/r2-agenda-operation-store.ts),
[runner](../../packages/application/src/favorites/favorite-resolution-runner.ts),
[runbook](cloudflare.md).

Correction : définir un délai maximal de récupération, des seuils et un signal
opérateur automatique; conserver les limites d'essais et les décisions privées.
Une reprise plus fréquente nécessiterait une décision explicite sur la cadence.

### A14 — P2 : documents et certification surestiment la couverture

Le brief annonce encore la candidate 1.0.0, classe les queues hors périmètre
puis les décrit dans le runtime, et prévoit des packages signés avec soumission
manuelle. La livraison actuelle prouve des ZIP et des installations temporaires,
pas une distribution signée avec mise à jour automatique. Le canary 1.0.39 a
obtenu deux résultats déjà VERIFIED : il n'a pas exercé une nouvelle collecte
ni une publication Agenda réelle. Le profil personnel reste non certifié.

Sources : [brief](../00-project-brief.md), [runbook](cloudflare.md),
[canary](../../scripts/infra/installed-discovery-canary.mjs),
[installation Firefox](../../apps/extension/scripts/installed-firefox.mjs).

Correction : matrice de certification explicitant frais/cache, première
installation/mise à jour, automatique/réveil forcé et synthétique/personnel;
réconcilier les documents après décision de distribution.

## Ce qui est déjà solide

| Domaine | Verdict | Preuve et limite |
| --- | --- | --- |
| Autorité privée/publique | CONFORME sur les chemins inspectés | Favoris et décisions restent IndexedDB; aucune migration privée demandée au Worker. |
| R2 conditionnel | CONFORME pour les cas testés | Retour null traité comme conflit, pages immuables et checkpoint référencé, reprise sous nouveau bail; tests workerd réels. |
| Publication interrompue | CONFORME pour les cas testés | Snapshot ready avant D1, confirmation R2 après publication, rejeu sémantique testé. |
| Identité | CONFORME pour le corpus testé | Références canoniques et matching borné; aucun premier résultat promu automatiquement dans les chemins audités. |
| Parser | CONFORME sur corpus synthétique | 1532 favoris dont 1400 médias; oracle externe ignoré et corpus personnel non testé. |
| HTTP extension | CONFORME sur les bornes testées | Timeouts, taille, pagination, reprise bornée et conservation du cache valide; A01/A06/A11 limitent la garantie globale. |
| Couvertures | CONFORME sur contrats testés | Référence/master absent produit 404, sans transformation; contenu effectif du bucket non inventorié ici. |
| Sécurité gateway | CONFORME sur tests locaux | HMAC, anti-rejeu et destinations bornées; aucun audit indépendant ni état secret distant prétendu. |
| Livraison | CONFORME sur preuves précédentes | ZIP reproductibles et hashes publics, Worker inspecté après déploiement; inspection administrative actuelle indisponible. |
| Gouvernance | CONFORME pour cet audit | AGENTS/CLAUDE/hooks inchangés; config utilisateur exclue; aucun changement runtime ou distant. |
| Diagramme nouveau | N/A | Audit documentaire sans modification d'architecture; les vues existantes sont relues et validées. |

## Ordre de correction recommandé

1. Rendre le parcours installé réellement utilisable : A01, A02, A03, A04.
2. Fermer les contrats incomplets : A05, A06, A07, A09, avec tests aux frontières.
3. Corriger les limites et courses : A08, A10, A11.
4. Certifier l'exploitation : A12, A13, A14, avec canary frais et mesures séparées.

Conserver D1 canonique, R2 opérationnel, la Queue existante et les ports projet.
Aucune preuve ne justifie une réécriture globale ou l'ajout d'un service.
L'objectif raisonnable est une reprise automatique de toutes les pannes
transitoires prévues, des états explicitement incomplets et une alerte des cas
nécessitant une décision; pas l'invention d'identités ou de dates pour atteindre
un pourcentage artificiel. Les correctifs produit restent à implémenter et à
valider; ce rapport termine l'audit, pas ces corrections.
