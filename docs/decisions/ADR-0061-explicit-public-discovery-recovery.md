---
scope:
  - apps/extension/wxt-entrypoints/background.ts
  - apps/extension/entrypoints/options/ResolutionStatus/**
  - apps/extension/runtime/resolution-status-messages.ts
  - apps/extension/runtime/favorite-resolution-continuation.ts
  - apps/extension/runtime/favorite-resolution-runtime.ts
  - apps/worker/src/index.ts
  - apps/worker/wrangler.jsonc
  - apps/extension/runtime/use-resolution-status.ts
  - packages/application/src/favorites/public-discovery-resolution.ts
  - packages/application/src/favorites/favorite-resolution-runner.ts
  - packages/application/src/use-cases/import-favorite-sources.ts
  - packages/application/src/public-discovery/public-discovery-contract.ts
  - packages/adapters-browser/src/catalogue/http-public-discovery-adapter.ts
  - scripts/infra/discovery-recovery-batch.mjs
  - docs/architecture/src/real-favorite-resolution.dataflow.json
review: on-change
revised: true
---

# ADR-0061 — Reprise explicite des demandes Public Discovery épuisées

Date : 2026-09-22

Révisé : 2026-09-28

Statut : accepté

## Contexte

Le profil réel a montré des lignes `RETRYABLE/PROVIDER_UNAVAILABLE` correspondant à des demandes Public Discovery déjà arrivées à `FAILED/ATTEMPT_LIMIT`. Une reprise automatique depuis chaque lecture de statut pourrait réactiver une charge fournisseur sans contrôle et masquer la frontière entre attente, échec transitoire et mutation de production.

## Décision

Après admission, `PENDING` est observé sans second POST, y compris après
expiration de `retryAt` ou redémarrage. Une échéance passée est bornée à une
minute pour éviter une boucle locale. `MISS` conserve l'admission normale;
`UNAVAILABLE` conserve la confirmation explicite de reprise.

Le banc installé ne redémarre ni le service worker ni le navigateur pendant
les admissions du pilote scellé. Il attend la projection locale et la preuve
corrélée, persiste les coûts validés par UUID dans des reçus privés exclusifs,
ferme l'admission des nouvelles lectures, met l'analyse en pause par
l'interface, puis draine les routes avant les tests locaux de conservation.
Les lectures déjà engagées conservent leur caractère fatal en cas d'erreur;
la fermeture ne relâche aucune garde de mutation. Un échec d'écriture du reçu
de coût interdit la certification. Une interruption garde la réservation, même sans
réponse d'admission reçue : une lecture de contrôle n'autorise jamais un renvoi.

L’extension expose une action utilisateur explicite, visible uniquement lorsqu’un compteur `providerPaused` est présent. Cette action :

- lit les `FavoriteSource` observés et leurs artefacts privés ;
- reconstruit la clé et la requête canoniques avec le même code que la résolution normale et sa prélecture groupée, y compris la référence exacte ou l’indice synchronisé unique compatible ;
- envoie le payload Public Discovery v3 exact via une méthode `requestRecovery` dédiée ;
- traite les éléments un par un avec la cadence d’admission bornée ;
- isole les erreurs par élément afin qu’un favori défectueux ne bloque pas le lot ;
- limite le démarrage de nouveaux éléments à une tranche de 15 secondes et dix soumissions, laisse au POST déjà admis ses 45 secondes, avance le curseur après chaque réponse interprétée et persiste l’échéance des erreurs transitoires ;
- enregistre la source en cours avant HTTP ; après interruption, lit son état plutôt que réarmer aveuglément un nouvel échec ;
- restaure l’alarme à chaque démarrage du service worker, du navigateur et après pause ; respecte l’échéance même lors d’une nouvelle action humaine ;
- refuse deux reprises simultanées et sérialise reprise et runner normal qui partagent le même adaptateur HTTP ;
- transmet les réponses `PENDING` au travail durable normal à leur échéance, sans nouvelle file ; les états terminaux seront interprétés par ce même runner ;
- relance ensuite la réconciliation ; seules l’action humaine, l’installation, la restauration et l’audit périodique réparent globalement la projection.

La lecture de statut et les reprises automatiques ne réarment jamais `FAILED` : seule l’action explicite initie un lot fini. Une réponse `UNAVAILABLE` persistante termine l’élément de ce lot mais conserve sa raison visible et son action humaine. Sa simple lecture normale ne consomme aucun essai local et est reportée de quinze minutes. Les anciennes limites d’essai locales ne sont pas requalifiées arbitrairement comme des pannes fournisseur. Une erreur permanente de contrat ou interne est enregistrée sur sa source et n’empêche pas le traitement des suivantes. La fin du lot supprime réellement la clé de curseur et l’alarme ; une alarme tardive sans curseur n’initie jamais un nouveau lot.

Un réveil Worker séparé, borné à un claim et déclenché toutes les dix minutes, traite les demandes D1 échues lorsqu’un signal Queue a été perdu ; le cron Agenda hebdomadaire est inchangé. Après un différé fournisseur, la continuation corrélée conserve l’échéance de cette demande et un second signal global est ajouté seulement si un autre travail est antérieur. Ainsi un différé ne masque pas un bail expiré, sans créer de doublon lorsque la même demande est la prochaine éligible. La cadence ne réclame aucun `FAILED` et n’en réarme aucun : seul le prédicat atomique des états `PENDING` ou `PROCESSING` expiré reste éligible. Le script de reprise vérifie que les trois runtimes manga existent, mais ne requiert pas qu’ils soient momentanément libres : le bail atomique du Worker reste l’autorité de cadence au POST et évite de rendre le lot impossible pendant une collecte normale. Aucun SQL manuel ni endpoint caché n’est ajouté. Le run canari et la reprise historique restent soumis au flux de production protégé et à une confirmation immédiate avant mutation distante.

En mode `worker-direct`, le client accorde jusqu’à 45 secondes au POST d’admission, comme le canari protégé. Le Worker réserve 100 secondes à une résolution Queue et le resolver 90 secondes à ses recherches. Cette borne couvre quatre titres manga cadencés sur les trois lanes, y compris les intervalles réels des fournisseurs, tout en restant finie. Les lectures conservent leur délai de 15 secondes. Une interruption ne déclenche jamais un second POST automatique : la reprise lit d’abord l’état D1 exact.

Le runner de reprise porte une projection stricte des champs v3 qu’il accepte
à sa frontière HTTP et dans le reçu D1. Il ne charge pas le `dist` TypeScript :
ce build utilise des imports ESM sans extension qui ne sont pas exécutables par
Node directement. La CI propre exécute donc le même runner que l’opérationnel,
sans dépendre d’un artefact généré ou d’un cache de runner.

Le runner opérateur exige `--scope` pour le prévol, la préparation et
l’exécution. Ce fichier privé provient de la liste réellement importée : son
schéma de version 1 contient `corpusDigest`, `sourceCount` et une à dix
`entries` uniques `ANIME`, `MANGA`, `MANHWA` ou `MANHUA`, chacune avec la clé v3 complète et son
`requestDigest`. Sa lecture exige un fichier régulier de 16 Kio au plus et
des permissions privées. L’empreinte seule ne prouve pas cette identité.
La sélection D1 est ciblée : une CTE de une à dix entrées pilote autant de recherches
sur l’index de clé primaire complète, jamais les dix plus anciens échecs
globaux. Le constructeur sépare SQL et paramètres ; le transport Wrangler
CLI encode ensuite uniquement les valeurs validées par une allowlist stricte,
sans revendiquer des bindings API distants. Chaque ligne doit encore être
`FAILED/ATTEMPT_LIMIT` avec huit essais
et conserver le payload et le digest attestés par le scope.

Le journal de version 3 lie le lot à son `scopeSeal`. Un scope absent,
divergent ou incomplet, un reçu legacy de version 2 ou une ligne modifiée
interdit l’exécution avant tout POST. Il n’existe aucune conversion implicite
des anciens reçus : ils restent intacts comme preuves historiques. Le scope
et les sceaux sont privés, ignorés par Git et absents des sorties publiques ;
les rapports ne conservent que les comptes, médias et codes fermés.

Avant `POST_STARTED` dans le journal, une réservation permanente par clé v3
complète est créée exclusivement (`wx`, mode `0600`), écrite puis
synchronisée avec `sync`. Un `requestDigest` différent ne contourne pas
cette réservation de la clé ; le digest reste vérifié contre le scope.
Elle interdit un second POST depuis
un autre processus ou lot utilisant le même répertoire de reçus. Une
interruption, même avant l’envoi HTTP, conserve cette réservation et bloque
le rejeu ; aucune suppression automatique ne la libère. Cette garantie
locale n’est pas une coordination multi-machine : un seul opérateur doit
utiliser le répertoire de reçus canonique, sans le dupliquer pour reprendre.

L’observation attend d’abord le résultat terminal, puis accorde jusqu’à
soixante secondes au coût fournisseur corrélé, avec une dernière lecture à
la borne incluse. Un différé de cadence ne consomme donc pas prématurément
cette fenêtre. La deadline totale de douze minutes par candidat reste
prioritaire : terminal sans coût final, absence d’appel fournisseur, 429,
erreur Queue ou dépassement des 300 lectures D1 cumulées interdisent le
certificat et l’admission suivante. Avant de persister `TERMINAL`, le runner
ferme et draine l’observateur, vérifie encore son état et relit le coût final.
Une erreur tardive ou un coût final invalide empêche donc le reçu terminal.
Cette évolution ne change ni `claim(1)`, ni Queue 1/1, ni les règles de
réarmement ou d’arrêt.

Le collecteur journalise un code d'échec fermé, le numéro de claim et
l'identifiant de corrélation, sans titre, URL ni empreinte de favori. Les
opérations fournisseur échouées portent le même identifiant et leur étape
`search` ou `hydrate`. Ces événements expliquent un échec sans transformer
`ATTEMPT_LIMIT` en diagnostic fournisseur et sans modifier l'état D1.

Si la recherche a identifié un candidat portant un ID lié d'un autre
fournisseur, un échec transitoire de l'hydratation primaire essaie cet ID exact
avant une nouvelle recherche par titre. L'identité retournée doit correspondre
à l'ID lié et rester compatible avec le média, les contraintes et le titre de
la source ; un lien absent ou incompatible ne devient pas `VERIFIED`.

Pour les médias connus, un budget D1 Worker atteint après des appels fournisseur
réussis conserve le fournisseur, l'alias, la page et les candidats déjà
inspectés dans le curseur D1. La continuation reprend à ce point sans répéter
les recherches terminées. Un refus avant tout appel réussi consomme toujours
un essai ; une lane antérieure en erreur ne peut pas être sautée par ce
checkpoint. La recherche réserve aussi le coût d'une hydratation avant de
dépenser le dernier créneau. Pour `UNKNOWN`, la lane anime est explorée avant
la lane manga ; son résultat borné accompagne le curseur manga, afin de garder
les deux preuves et l'ambiguïté inter-lanes après reprise. Une lane anime en
erreur n'est jamais déclarée complète. Le CLI opératoire exige encore un
reparse du média avant toute reprise réelle d'une clé `UNKNOWN`.

Le banc installé utilise le même scope et la même réservation permanente que
le CLI. Au-delà de deux admissions, un scope est obligatoire; le pilote scellé
exige exactement une source par clé et un budget explicite égal à la taille du
lot, sans refresh. Le POST dispose de 45 secondes. L'observateur démarre avant
le chargement du profil et le clic explicite, puis suit chaque UUID d'admission.
Quand le jeton Wrangler local ne peut pas ouvrir Tail, l'opérateur peut fournir
une URL de session Tail Cloudflare éphémère par `TOBIRINK_WORKER_TAIL_URL`.
Le transport WebSocket impose `wss`, l'hôte Tail officiel et le sous-protocole
`trace-v1`. Le client `ws` direct utilise la trame attendue par Tail et
termine la connexion si Cloudflare ne confirme pas sa fermeture après deux
secondes; il alimente le même parseur borné, sans écrire l'URL dans les reçus
ni les journaux. Une erreur de transport ou une fermeture prématurée échoue
fermée. La session est fermée après observation et supprimée côté Cloudflare.
Son amorçage autorise au plus vingt-quatre lectures `MISS` espacées de
2,5 secondes; le banc lui accorde soixante-quinze secondes, hors budget par clé.
Sans cette preuve, il échoue fermé avant toute admission. Les lectures de
prévol sont comptées séparément des 300 lectures D1 corrélées par clé.
La clôture draine les événements tardifs et revérifie chaque coût avant preuve.
`TOBIRINK_INSTALLED_RECOVER_EXHAUSTED=1` commande le véritable bouton; cette
variable ne remplace pas la confirmation immédiate du lot par l'opérateur.
Un coût public terminal ne certifie jamais à lui seul la projection Library.

La composition Worker transmet aussi le quatrième argument `searchProgress`
de `gateway.defer` à `deferClaim`. Le curseur et les candidats bornés produits
après quatre pages doivent traverser cette frontière avant le signal Queue.
MangaUpdates lit désormais cent résultats par page sans changer la représentation
du curseur historique en tranches de vingt-cinq : un curseur persistant 81
reprend à la page 21 de cent, au même premier résultat, et le prochain curseur
devient 85. Les cent résultats sont inspectés en quatre tranches bornées de
vingt-cinq ; la priorité de correspondance reste globale, les candidats
retenus restent plafonnés à vingt, et le plafond HTTP de 512 Kio demeure.
Ce changement ne relance aucun POST et ne certifie pas rétrospectivement un
pilote expiré.
Un report de cadence sans nouveau curseur conserve celui de la requête réclamée
au lieu de l'effacer; un nouveau checkpoint reste prioritaire.
La régression intègre le vrai collecteur, la composition et D1 : pages 1 à 4,
curseur 5 persisté avec zéro tentative consommée, puis reprise corrélée à la
page 5 et publication vérifiée sans rejouer les pages précédentes.
Le CLI de reprise reste limité aux échecs épuisés : les MISS relèvent de
l'admission normale, les PENDING de l'observation, sans réarmement implicite.

Un échec de collecte directe conserve aussi son code interne fermé et son coût
réel corrélé avant de remonter le HTTP 503. Le message brut de l'exception reste
privé. Cette preuve ne change ni l'état de la demande ni les règles de reprise :
une admission interrompue conserve sa réservation et n'est jamais rejouée.

## Conséquences

Un claim générique ne reprend pas un jeton PENDING attribué depuis moins de
quinze minutes sans progrès. Un traitement PROCESSING garde son bail existant;
son expiration reste récupérable sans délai supplémentaire.
Les claims par clé ou jeton restent immédiatement
éligibles à leur échéance. Le prochain réveil générique utilise la même borne,
pour ne pas boucler pendant cette protection. Après quinze minutes depuis
`updated_at`, la récupération générique redevient possible : une continuation
perdue n'abandonne donc pas définitivement la demande. Cette borne correspond
au bail de traitement existant et dépasse la fenêtre de certification de douze
minutes; une récupération tardive ne certifie pas rétroactivement le pilote.
La régression reproduit un réveil générique qui vole le claim et sa corrélation
avant le signal ciblé. Aucun schéma, réarmement ou budget n'est modifié.

Un réveil ciblé anticipé qui ne peut pas encore réclamer sa ligne conserve
le jeton opaque et l’UUID de corrélation, puis reprogramme au plus un signal
ciblé avec un délai de 1 à 900 secondes. Son coût est `backoff`, même si
aucune nouvelle demande n’a été réclamée ; ce n’est pas un résultat
`unchanged` sans fournisseur. Le différé initial restitue la tentative et le
réveil anticipé n’en consomme aucune. Un signal générique vide reste inchangé.
Le canari n’accepte ce coût `provider:none` qu’avec le même UUID et un seul
envoi Queue réussi. Il applique le budget D1 cumulé dès les différés et
exige toujours un coût fournisseur terminal corrélé à la borne d’observation.
Sans cette preuve, même une lecture `VERIFIED` laisse le certificat incomplet.
Le rollback de cette qualification ne réarme ni ne supprime aucune ligne.

Si l'observateur du profil installé échoue, son rapport privé conserve
uniquement un code de cause issu d'une allowlist fermée ; un message inconnu
devient `discovery-recovery-failed`. Le résumé ne publie jamais l'exception
brute. Ce diagnostic n'autorise ni rejeu d'une clé réservée ni certification
rétroactive d'un pilote interrompu.

La récupération est observable et réversible au niveau applicatif : désactiver le contrôle empêche toute nouvelle action, sans supprimer ni réécrire les données existantes. Une reprise de centaines d’entrées prend volontairement du temps afin de respecter la cadence publique ; les réponses `PENDING` restent dans la file et sont réconciliées ultérieurement.

## Validation

- typecheck extension ;
- régression reproduite avec le véritable `HttpPublicDiscoveryAdapter` : receiver préservé et requête HTTP réellement transmise ;
- tests des clés et payloads communs, des indices synchronisés et de la prélecture groupée ;
- tests reprise avec vrai adaptateur HTTP et stockage de contrat : dix demandes, quinze secondes, redémarrage, pause, `Retry-After`, erreur permanente, lecture après interruption, fin de lot et `UNAVAILABLE` sans boucle ;
- test du rendu UI ;
- tests du runner opérateur : scope obligatoire et privé borné à 16 Kio, identité complète et digest, refus du journal legacy ou divergent, SQL ciblé par dix clés primaires, réservation exclusive conservée entre processus et lots ;
- tests d’observation : différés de 120 et 600 secondes, fenêtre de coût après le terminal, lecture à soixante secondes, deadline totale, drain final et refus des erreurs tardives sans reçu terminal ;
- tests de diagnostic : motif d'observateur autorisé conservé, message inconnu ou ressemblant à un code rabattu sur le code générique ;
- aucune récupération distante exécutée pendant cette modification.
