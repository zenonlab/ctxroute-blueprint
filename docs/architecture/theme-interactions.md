# Interactions programmables : scène, objets et interface

État : intention produit et règles sémantiques révisées, 8 septembre 2026.
Aucun moteur d'interactions, widget ou langage de thème implémenté.
Voir [ADR-0039](../decisions/ADR-0039-programmable-theme-interactions.md),
les [contrats C0–C6](module-contracts.md) et le
[schéma runtime](src/runtime-infrastructure.architecture.json).

## Ce que le produit doit permettre

Les « icônes » du thème peuvent être des objets, une partie de géométrie, un
portrait, un sprite ou un bouton. Elles ne sont pas limitées aux raccourcis
Explorer/Finder. Ceux-ci restent des éléments natifs distincts à respecter
lorsqu'ils recouvrent le wallpaper.

La scène et l'UI peuvent agir dans les deux sens : un objet ouvre un panneau,
un bouton anime un objet, une animation terminée modifie un panneau, un changement
de paramètre transforme le décor. Le thème peut orchestrer plusieurs cibles à
partir du même événement, selon des règles explicites écrites par son auteur.
La liberté porte sur les combinaisons et l'extension des capacités ; elle ne signifie
ni exécution de code système illimitée, ni parité graphique garantie sur tous les OS.

| Origine d'un événement | Exemples de réactions configurables |
| --- | --- |
| Objet, sous-maillage, région ou sprite sélectionné | Ouvrir/fermer un panneau, animer une autre cible, changer caméra ou effet |
| Bouton, onglet, slider ou champ validé | Modifier un état, lancer/arrêter une animation, régler un effet ou un son |
| Survol, sortie, appui, relâchement ou geste autorisé | Retour visuel, prévisualisation, déplacement borné, annulation |
| Début, marqueur ou fin d'animation | Actualiser un panneau, déclencher une séquence locale ou restaurer un état |
| Changement d'état ou résultat de commande | Actualiser texte, jauge, personnage ou disponibilité d'un contrôle |
| Événement système/session autorisé | Représentation d'activité, notification, changement d'ambiance |
| Échéance explicitement programmée | Animation d'ambiance ou transition locale, dans le budget du profil |

Les actions cibles comprennent : visibilité, position/rotation/échelle, variante
de matériau/texture, paramètres d'effets, lecture/pause/arrêt d'animation, caméra,
audio, état local et navigation UI. Leur support est déclaré, pas supposé.
Les actions OS et de sessions restent des intentions soumises au contrôle local.
Un événement d'animation ne donne pas davantage de droits qu'un bouton.

## Modèle commun, sans dépendance au moteur

Une liaison décrit conceptuellement : source stable, événement, condition,
cible stable, action typée et paramètres, puis politique de concurrence/annulation.
Les noms de champs, format de sérialisation et langage de programmation restent
à choisir en E3 ; ce document n'introduit pas un DSL exécutable.

Séparer les identités des objets, sous-parties interactives, instances de panneaux,
contrôles UI, animations, effets et sessions. Les liaisons utilisent des références
résolues, jamais un pointeur moteur ou l'égalité implicite de noms de fichiers.
Deux exemplaires d'un objet peuvent partager une ressource sans partager leur état.
Le thème peut lier différentes cibles ; aucune règle Mario Kart ou autre jeu dans
le cœur. Les données privées du jeu restent dans la bibliothèque locale, les
liaisons créées dans la recette partageable.

Le contrôle arbitre les commandes et possède l'état logique du thème. L'hôte
gère les instances visuelles, animations et effets ; les interpolations par frame
restent locales au rendu. Les événements sémantiques et résultats utiles remontent
au contrôle, pas chaque sommet ou frame. Les panneaux lisent l'état accepté et
émettent des intentions ; ils ne constituent pas une deuxième source de vérité.

### Exemple de parcours, indépendant d'un jeu

1. L'utilisateur sélectionne un objet `console`; une règle ouvre son panneau.
2. Le bouton `activer` demande l'animation de `porte` et l'effet de `lampe`.
3. Le contrôle accepte les actions compatibles ; l'hôte commence leur exécution.
4. Le panneau affiche « en cours » à partir du résultat accepté, pas du clic brut.
5. La fin de l'animation met l'état à « ouvert » et actualise le panneau.
6. Le bouton `réinitialiser` annule les actions encore actives et restaure les
   paramètres explicitement définis, sans toucher aux sessions de travail.

Les événements d'une ancienne composition ou d'une instance détruite sont refusés.
Si une cible manque, une capacité est absente ou une action échoue, le panneau
reçoit un résultat explicite ; pas de modification partielle présentée comme succès.
Pour plusieurs actions, déclarer si elles sont indépendantes ou ordonnées. Une
séquence interrompue n'est pas une transaction capable d'annuler un effet OS.

## Panneaux, widgets et modes de présentation

L'UI fait partie du produit : panneaux, boutons, listes, onglets, sliders,
champs de saisie, menus et états de chargement/erreur. Le thème définit apparence,
disposition, données affichées et comportements, en réutilisant les composants
UI choisis plutôt qu'en réécrivant systématiquement leur interaction de base.

Un panneau possède une identité logique et un état uniques. Le connecteur choisit sa
présentation selon les capacités OS ; il ne crée pas simultanément une copie décorative
et une copie native actionnable. Le PoC macOS 1 a précisément révélé ce défaut avec un
panneau rendu par l'extension et un panneau AppKit du compagnon. Cette structure est
historique et interdite par [ADR-0049](../decisions/ADR-0049-platform-connectors-and-macos-poc2.md).

Trois représentations sont à distinguer :

- **UI dans la scène** : panneau fixé à un objet ou placé dans l'espace 3D.
- **UI superposée au rendu** : panneau 2D dans la surface du thème, indépendant
  de la perspective de caméra, mais soumis au placement OS de cette surface.
- **Fenêtre/panneau natif distinct** : surface explicitement ouverte pour les
  interactions nécessitant une fenêtre accessible ou un focus clavier fiable.

Ces modes partagent l'état et les intentions, pas nécessairement le backend de
rendu. Une UI dessinée sur un wallpaper sous les icônes ne devient pas une fenêtre
au premier plan. La capacité « afficher un panneau » et sa capacité « recevoir
une saisie sûre » doivent être qualifiées séparément via C5.
Une représentation non supportée donne un diagnostic ; un repli doit être déclaré,
pas inventé en modifiant silencieusement l'expérience de l'auteur.

### Projection macOS à deux plans

Le chemin retenu par [ADR-0048](../decisions/ADR-0048-native-wallpaper-dynamic-object-plane.md)
sépare le wallpaper natif complet et le calcul de hit-test. L'extension possède tous
les pixels du décor et des objets ainsi que leurs animations. Lors d'un clic global,
le compagnon évalue la même fonction de transformation au temps monotone courant puis
teste les coordonnées, sans posséder de second état de course. Son `CGEventTap` actif
supprime l'appui et le relâchement d'un clic confirmé sur un objet ; les autres événements
sont inchangés. Aucune fenêtre ne suit les objets et une grande surcouche plein écran
est interdite. Le panneau natif de la sonde est un HUD fixe ; sa région possède la
priorité sur les objets mobiles du thème.

Une action d'affichage Finder peut être exposée comme bouton local réversible, mais
demeure une capacité de l'adaptateur macOS et non une commande portable du langage de
thème. L'implémentation actuelle utilise la préférence non documentée `CreateDesktop` :
elle ne doit jamais être déclenchée au chargement ou par un test automatisé, et sa
défaillance ne doit pas toucher aux fichiers.

Le tap est suspendu avec la session ou les écrans sans faire disparaître ni
recharger les objets du wallpaper. Un kart, personnage, bouton 2D ou projection
d'un sous-maillage 3D utilise la même identité stable. La nature du renderer ne
change ni les liaisons de session, ni l'ordre de formation, ni les intentions UI.

L'ouverture d'un panneau ne doit pas démarrer le terminal pour héberger l'UI du
wallpaper seul. À l'inverse, afficher un véritable shell dans un panneau exige
le composant terminal et son contrat C4 : ne pas réimplémenter une grille VT avec
des labels 3D, ni exposer le flux PTY à tous les scripts de thème.

## Entrées, focus et accessibilité

La priorité native demeure : une icône Explorer/Finder ou une application située
devant l'ancre doit conserver son geste. À l'intérieur d'une surface qui reçoit
légitimement l'entrée, une seule cible gagne le hit-test selon l'ordre UI/scène
annoncé. Un bouton au-dessus d'un objet ne déclenche pas simultanément les deux.
La propagation à d'autres cibles n'existe que si une règle la demande explicitement.

Le geste appartient à la cible de capture convenue jusqu'à relâchement/annulation.
Perte de focus, fermeture de panneau ou destruction d'objet annulent la capture.
Les opérations déclenchées sur appui et sur clic confirmé sont distinctes ; ne
pas lancer une action sensible au début d'un glisser qui sera ensuite annulé.

La saisie clavier/IME est réservée à l'UI explicitement focalisée. Pas d'écoute
globale du texte tapé dans les autres applications. Prévoir parcours clavier,
libellés accessibles, indication du focus, fermeture/annulation et préférences
de mouvements réduits. Une UI dessinée en 3D n'est pas réputée accessible : ses
fonctions essentielles doivent avoir une présentation utilisable à qualifier.

## Exécution bornée et sécurité

« Dans tous les sens » ne signifie pas diffusion globale incontrôlée.
Valider types, références et capacités avant activation ; acheminer seulement
vers les abonnements utiles. Les règles sont internes au produit, pas un nouveau
service IPC générique ou un démon par widget.

- Corréler événement, commande, résultat et révision de composition.
- Borner longueur/profondeur des chaînes, événements en attente et temps de calcul.
  Une boucle objet→panneau→objet doit s'arrêter avec diagnostic si elle diverge.
- Un changement d'état inchangé ne réémet pas un événement sans nécessité ; éviter
  les boucles de liaison bidirectionnelle entre slider et propriété d'objet.
- Définir par action répétée : ignorer, remplacer, mettre en file bornée ou combiner
  si la propriété s'y prête. Pas de milliers d'effets empilés par un survol.
- Annuler/désabonner les instances libérées ; résultats tardifs sans cible rejetés.
- Une action système utilise une association locale approuvée. Le contenu d'un
  champ UI est une donnée validée, pas une chaîne exécutée par un shell.
- Les clics artificiels et événements de script ne fabriquent pas une preuve
  d'activation utilisateur. Les droits sont revalidés à l'exécution ; refus explicite.
- Aucune relance aveugle après timeout d'une action externe au résultat inconnu.

Le mécanisme de scripting reste ouvert. Aucun choix implicite de JavaScript,
Wasm, Godot ou autre moteur ne découle de ces possibilités d'interaction.

## Énergie et reprise

Les widgets et liaisons inactifs ne créent pas de polling ou de cadence de rendu.
Changements de sliders/paramètres remplaçables coalescés ; commandes sémantiques
non perdues. Une animation ou un effet actif demande une échéance dans le budget.
Leur arrêt doit retirer cette échéance lorsqu'elle n'est plus nécessaire.

Évaluer la visibilité **par surface** : si le décor est masqué mais un panneau
natif reste visible, seul ce panneau doit continuer les traitements nécessaires.
Un panneau fermé ne maintient pas le GPU éveillé pour une animation invisible.
La reprise choisit explicitement geler/reprendre ou rattraper l'état visuel ; ne
pas rejouer en rafale des actions OS à partir de timers ou fins d'animation manqués.
L'audio suit sa politique explicite, sans déduction automatique à partir du focus.

## Tranche de validation et limites

Le [cas course et formation](ai-prepared-behaviors.md#cas-course--vrais-virages-formation-stable-et-sessions)
ajoute un comportement spatial réel : trajectoire, virages, place stable par
session et récupération visuelle. Ce n'est pas un simple mouvement du fond derrière
des icônes fixes. Les contrôleurs partagent une autorité de transformation explicite
et ne modifient pas les sessions. Tests A01–A08 complémentaires aux I ci-dessous.

E2 ajoute à la scène synthétique : un objet ouvrant un panneau, un bouton animant
un autre objet et un effet, puis un retour d'état à la fin. Variante à cible absente
et refus d'entrée inclus. Cette preuve doit précéder l'adoption d'un rendu qui ne
saurait gérer que du décor passif. Elle ne demande pas une bibliothèque de widgets
complète, une ROM ou un terminal intégré.
E3 formalise les liaisons et permissions du package ; E4 vérifie la session réelle ;
E5 qualifie les présentations et l'accessibilité par OS. Pas de changement de l'ordre E1–E6.

| Test | Échéance | Résultat attendu |
| --- | --- | --- |
| I01 | E2 | Objet → panneau → bouton → animation + effet → retour UI, sans terminal ni exception par jeu |
| I02 | E2 | UI au-dessus d'un objet : une seule action ; icône native superposée prioritaire |
| I03 | E3 | Cible/type/capacité absente : refus ou repli déclaré, aucun faux succès |
| I04 | E3 | Liaison cyclique et événements répétés : quotas appliqués, mémoire bornée, diagnostic |
| I05 | E3 | Changement de thème/fermeture pendant animation : captures, abonnements et callbacks obsolètes libérés |
| I06 | E3–E4 | Commande OS non autorisée, texte de champ et événement synthétique : aucune élévation de droits |
| I07 | E4–E5 | Champ focalisé, IME, clavier, annulation et accès aux fonctions sans souris utilisables |
| I08 | E2 puis E5 | Décor masqué/panneau visible puis panneau fermé : invalidation et énergie adaptées par surface |
| I09 | E4 | Portrait ou panneau sélectionne une session sans accès du thème au flux PTY |
| I10 | E3–E5 | Reprise après suspension : état cohérent, aucune rafale d'actions externes |

Tous ces tests sont prévus, non exécutés. L'extensibilité des actions est une
exigence de conception, pas une promesse que toute fonction imaginable existe dès
le MVP. La priorité énergie reste applicable à chaque nouvelle capacité.
