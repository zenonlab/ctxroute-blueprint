# Contrats des modules et réversibilité

État : spécification sémantique de conception, 7 septembre 2026. Aucun contrat
exécutable ni test produit implémenté. Les identifiants C0–C6 organisent la review ;
ils ne figent ni langage, ni ABI de plugins, ni sérialisation ou protocole IPC.
Voir [ADR-0037](../decisions/ADR-0037-replaceable-module-contracts.md),
le [schéma runtime C1–C5](src/runtime-infrastructure.architecture.json) et
la [feuille de route](../03-product-roadmap.md).

## Règles de dépendance

Le contrat commun exprime les identités, données et intentions du produit, sans
importer les types du moteur, de l'interface terminal ou des APIs natives.
Les intégrations dépendent de ce contrat, pas l'inverse. Interdire ces imports
dans les modules communs par un contrôle de dépendances lorsque la stack existe.
Ne pas encapsuler toutes les APIs de bibliothèques : couvrir seulement les
frontières nécessaires aux parcours et tests ci-dessous.

Le thème possède l'apparence et le comportement créés, le cœur possède les
associations autorisées, le gestionnaire de sessions possède les PTY/processus.
L'hôte possède l'état visuel transitoire et les ressources GPU. La préparation
résout les données privées sans les ajouter au package partageable. Changer de
technologie ne doit pas transformer les caches du moteur en seule source durable.

Une séparation en modules n'exige pas des processus séparés. Utiliser des appels
internes typés lorsque possible. Si un échange traverse un processus, conserver
la même sémantique avec messages bornés et contrôle du pair. Ni port public, ni
bus générique, ni plugin natif téléchargeable ne découle de cette spécification.

## Catalogue des contrats

En mode wallpaper seul, C2 suffit à demander les actions locales au contrôle
autorisé ; C3 n'est requis que pour les capacités de sessions disponibles.
L'absence ou la déconnexion du terminal désactive ces associations sans bloquer
le décor et sans démarrer implicitement un PTY. Le schéma ne prescrit pas un
processus de contrôle supplémentaire. Les essais [B-F](../04-experimental-protocol.md#b-f--autonomie-et-domaines-de-panne)
vérifient cette autonomie et les limites de protection contre les pannes.

| Contrat | Producteur → consommateur ; propriétaire | Contenu minimal | Erreurs et limites |
| --- | --- | --- | --- |
| C0 — Recette | Auteur → préparateur ; thème | Identité/version de thème, références logiques, paramètres, ancres, comportements et capacités requises/optionnelles | Une recette ne donne ni chemin privé libre, ni handle moteur/PTY, ni permission d'exécuter une commande. Import non fiable, taille et profondeur bornées. |
| C1 — Sélection résolue | Préparateur → contrôle ; préparateur | Révision de composition, ressources sélectionnées et versions, liens entre objets, capacités et diagnostics ; accès local limité aux ressources résolues | Référence ambiguë/manquante ou capacité requise absente : échec explicite. Ne pas deviner un autre asset ; ne pas charger le jeu entier. |
| C2 — Scène et intentions | Contrôle ↔ hôte ; contrôle pour activation, hôte pour état visuel | Préparer/activer/libérer une composition, mises à jour ciblées, profil énergétique ; retour prêt/échec et intention d'ancre avec révision de scène | Événement d'ancienne scène refusé. Pas d'accès direct aux commandes OS depuis l'hôte. Aucune scène complète sérialisée à chaque frame. |
| C3 — Actions et états de session | Contrôle ↔ sessions ; gestionnaire de sessions | ID de session opaque stable, actions autorisées de création/fermeture/resize selon le parcours, état et résultat corrélé | Apparence ≠ identité. Action absente ou non autorisée refusée ; fermeture du décor ne ferme pas le shell. Les IDs ne sont pas des preuves d'autorisation. |
| C4 — Terminal | Sessions ↔ interface terminal ; sessions pour transport, interface pour interprétation/affichage | Flux d'octets ordonné, saisie du terminal focalisé, dimensions, état du processus et contrôle de débit | Backpressure bornée sans perte silencieuse de texte. Le thème reçoit seulement les états autorisés, jamais le flux terminal. La reprise du texte exige une politique de tampon/rejeu distincte. |
| C5 — Présentation native | Hôte ↔ adaptateur desktop ; adaptateur pour cycle de surface, hôte pour GPU | Créer/attacher, configurer, invalider, détacher ; coordonnées et échelle, génération de surface, capacités input/visibilité et motif | Les handles natifs restent dans cette intégration privée. Rendu et surface peuvent devoir être remplacés ensemble. Une capacité inconnue n'est pas disponible. |
| C6 — Résultats d'ingestion | Lecteur → bibliothèque/préparateur ; bibliothèque pour identités durables | Provenance et version d'entrée, identités sources, ressources et relations comprises, couverture et diagnostics privés | Conserver l'information comprise et qualifier l'inconnue. La sortie native d'un outil n'est pas automatiquement le contrat canonique. Aucun envoi privé vers une IA distante. |

C0 et C6 appartiennent à la préparation détaillée dans
[game-transformation.md](game-transformation.md) ; le schéma runtime n'affiche
que C1–C5. Les liens du schéma représentent des échanges, pas des RPC imposés.

Extension sémantique [ADR-0039](../decisions/ADR-0039-programmable-theme-interactions.md) :
C0 décrit aussi panneaux, contrôles et liaisons événement/action ; C1 résout leurs
cibles et capacités. C2 transporte intentions, résultats corrélés et changements
d'état logique pour la scène **et** l'UI, ainsi que les événements significatifs
d'animation/effet. Le contrôle arbitre cet état ; l'hôte garde les interpolations
et l'état visuel local, sans échange par frame. C5 qualifie chaque présentation
(dans la scène, overlay ou fenêtre distincte), sa visibilité et son focus.
Ce sont les mêmes contrats, pas un nouveau bus. Les règles de propagation,
d'annulation et de quotas figurent dans [theme-interactions.md](theme-interactions.md).

## Identités, versions et migration

Les [contrôleurs préparés par IA](ai-prepared-behaviors.md) réutilisent C0–C6 :
C1 vérifie ressources et capacités exécutables, C2 active les contrôleurs bornés.
La génération ne vaut ni implémentation d'une capacité absente ni autorisation.
C3 distingue état de processus, travail annoncé et état inconnu/périmé ; silence
PTY ne signifie pas erreur. Une animation de récupération ne change pas l'état
réel d'une session et ne relance pas son travail. Provenance et fraîcheur des
événements doivent être explicites avant d'y associer une réaction du thème.

Séparer identité logique et empreinte de contenu : deux objets peuvent partager
la même texture sans devenir le même objet. Une référence locale précise son
espace d'identités, sa version et son rôle ; sa résolution fournit une ressource
autorisée sans exposer un chemin arbitraire au thème. Scène, minimap et portrait
utilisent des relations explicites, pas une égalité de noms déduite par le cœur.

Versionner séparément contrat, thème, adaptateur et dérivé. Un producteur annonce
sa version et ses capacités ; le consommateur vérifie la compatibilité avant
activation. Version majeure inconnue ou champ requis incompris : rejet. Les
extensions optionnelles ne sont ignorées qu'avec une règle et un diagnostic.
Les noms exacts, bornes et codecs seront définis lors de l'implémentation.

Les migrations produisent une nouvelle représentation validée sans écraser
l'original. Un cache est indexé par les versions/empreintes de ses entrées,
la configuration et le backend de préparation ; changement incompatible =
reconstruction. Un changement de moteur peut nécessiter un nouvel adaptateur
et une recompilation locale, pas une nouvelle extraction si les sources utiles
sont conservées. Ne pas promettre une migration gratuite ou sans pertes pour
une sémantique que l'ancien extracteur n'avait jamais comprise.

## Activation et actions sûres

1. Le contrôle demande la résolution et vérifie contrat, capacités et permissions.
2. L'hôte prépare une nouvelle composition identifiée sans changer les sessions.
3. Le contrôle l'active après confirmation ; en cas d'échec, conserver l'ancienne
   lorsque le budget permet sa rétention, sinon passer à un repli annoncé.
4. Un clic porte l'ancre et la révision active ; le contrôle retrouve l'association
   locale et revalide les droits avant d'exécuter une intention.
5. Une fois l'ancienne composition libérée, ses événements tardifs sont ignorés.

Exemple : le portrait associé à `session-42` demande sa sélection. Le cœur
résout l'ID et demande à l'interface d'afficher cette session ; ni le portrait ni
le moteur n'écrivent dans son PTY. La saisie reste réservée à l'interface focalisée.
Un lancement d'application utilise une association locale approuvée, jamais un
nom sémantique proposé par IA comme autorisation.

Corréler commandes et résultats. Pour les actions à effets externes, ne pas
réessayer automatiquement après timeout : résultat potentiellement inconnu.
Dédupliquer les requêtes déjà acceptées dans la portée convenue ; aucune garantie
universelle « exactement une fois ». Limites de queue, délais, annulation et
politique de reprise doivent être fixés avant d'implémenter chaque échange.

## Énergie, surfaces et personnalisation

L'hôte décide de dessiner selon invalidation, animation active et budget fourni.
Fusionner les changements visuels remplaçables, pas le texte ou les actions.
Suspendre les soumissions sur surface perdue/masquée connue ; si la visibilité
est inconnue, appliquer le repli énergétique annoncé. L'adaptateur numérote les
générations de surface : une réponse GPU/input obsolète ne cible pas sa remplaçante.
L'ordre d'arrêt libère les ressources de présentation avant destruction de leur
support natif, selon les contraintes du backend choisi.

Socle portable : intentions, associations, références, transforms et comportements
effectivement retenus. Extensions : effets ou shaders spécifiques déclarent leur
backend/capacités, version et repli éventuel. Une extension sans repli peut rendre
un thème indisponible ailleurs ; ne pas prétendre rendre tout effet portable.
Les scripts de thème utilisent une API bornée, jamais des objets internes du
moteur comme contrat public. Aucun langage de scripting n'est adopté ici.

Changer l'interface terminal ne garantit pas la survie d'un processus déjà lancé
si celle-ci possède encore le gestionnaire de sessions : c'est précisément une
frontière à tester. Distinguer remplacement logiciel, changement de thème et
remplacement à chaud ; seul le changement de thème doit être transparent dès le MVP.

## Tests de remplacement

Tous les tests suivants sont prévus, non exécutés. Ils n'exigent pas deux moteurs
complets : doubles de test, intégrations minimales et fixtures originales suffisent
pour prouver certaines frontières, pas une fidélité de rendu entre moteurs.

| ID | Échéance | Preuve de sortie |
| --- | --- | --- |
| R01 | E2 | Contrôle et intentions testés avec hôte factice, sans GPU ni imports du moteur dans le cœur. |
| R02 | E2 | Même sélection synthétique en fenêtre puis en desktop ; perte/recréation de surface et capacités absentes correctement traitées. |
| R03 | E2 | Image 2D, objet 3D animé, transparence et clic dans une petite scène originale ; variante visuelle échangeable et coût par état mesuré. Pas seulement un triangle. |
| R04 | E2 puis E3 | Fixture synthétique de liens scène/minimap/portrait résolue sans identifiant de jeu hardcodé ; références manquantes signalées. Aucun lecteur de ROM requis. |
| R05 | E3 | Reconstruction des dérivés dans un cache de test neuf avec empreintes sources inchangées ; migration non destructive et export sans ressource privée. |
| R06 | E3 | Extension requise absente, version incompatible, clic d'ancienne scène et action non autorisée rejetés ; absence d'exécution externe implicite. |
| R07 | E4 | Deux shells survivent au changement/arrêt de la scène ; rendu terminal testé via son contrat sans accès du thème au flux sensible. |
| R08 | E4–E5 | Saturation des flux et délais d'action : mémoire bornée, texte ordonné, aucune répétition automatique d'un lancement au résultat inconnu. |

E1 prépare ces fixtures et examine les contraintes terminal/import sans les
implémenter intégralement. E2 utilise une représentation expérimentale minimale ;
E3 formalise le package public après ces preuves. Toute adoption d'une technologie
documente aussi ce qui reste spécifique, le coût estimé de sortie et les tests
à rejouer. Les abstractions qui ne protègent aucun parcours ne sont pas créées.
