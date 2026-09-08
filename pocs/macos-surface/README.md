# Sonde macOS isolée

Un exécutable SwiftPM sans dépendance tierce : `ProbeCore` contient l'état pur,
`SurfaceProbe` la fenêtre AppKit et `ProbeCoreTests` les tests. Ce n'est ni le
moteur de thèmes, ni un terminal, ni une sandbox pour contenu hostile.

Depuis la racine du dépôt, avec Xcode et une session macOS graphique :

```sh
sh pocs/macos-surface/probe.sh test
sh pocs/macos-surface/probe.sh desktop --duration 60
```

`desktop` lance réellement la surface de bureau, pas la fenêtre de contrôles.
Le fond demande maintenant l'animation ; il reste transparent aux clics.
Le menu **WP** dans la barre macOS donne Pause/Reprendre, Animation, Halo et Arrêter.
Les clics sur l'objet du fond ne sont pas activés : ils restent à qualifier face à Finder.
Variante d'essai uniquement : `desktop --split-input --duration 180`.
Elle place quatre zones cliquables en formation et leur panneau au-dessus des icônes,
sous les applications. Une icône superposée n'a PAS la priorité : ce n'est pas
le comportement produit validé. Le premier clic est accepté sans activation de
fenêtre ; son routage réel reste à éprouver. `split_mouse_downs` distingue les
événements souris reçus des actions programmatiques du smoke.
Avec un wallpaper natif déjà actif, `desktop --split-input --overlay-only --duration 180`
ne redessine ni le fond ni les véhicules et ne déplace aucune fenêtre invisible. Son
`CGEventTap` calcule la position courante et consomme seulement un clic qui touche un
objet, afin d'éviter l'action macOS concurrente. Ce mode demande l'autorisation
Accessibilité. La ressource
`Resources/formation-theme.json` décrit piste, slots, identités et couleurs ; le
solveur générique conserve l'ordre et calcule les orientations dans les virages.
Le panneau d'objet est fixe en haut à droite : aucune fenêtre ne poursuit un véhicule.
Sa zone est exclue du hit-test global, afin qu'un véhicule situé derrière un bouton ne
reçoive pas le même clic. L'interrupteur « Fichiers du bureau » bascule la
préférence Finder non documentée `CreateDesktop`, puis demande la relance de Finder.
Il ne déplace et ne supprime aucun fichier ; le smoke ne l'actionne jamais.
La même bascule existe dans **WP → Fichiers du bureau** comme commande de secours.
Le contrôleur redémarre explicitement le service Finder de la session utilisateur via
`launchctl kickstart` après chaque changement.
Pour un essai manuel qui ne disparaît pas après dix minutes, ajouter `--persistent`.
Ce mode reste actif jusqu'à l'action **Arrêter le fond** du menu WP :

```sh
sh pocs/macos-surface/probe.sh desktop --split-input --overlay-only --persistent
```
Apple ne documente pas cette clé comme API publique : cette capacité est donc un
adaptateur expérimental macOS, pas une garantie portable du produit.
`--export-still` crée notre image PNG à côté de la .app, sans changer le fond système.
Ces deux options exigent le mode desktop ; l'export exige le lancement en .app.
La fenêtre et sa couche de dessin sont conservées aux changements de Space/réveil.
L'absence de blanc pendant les transitions n'est pas encore démontrée.
Pour la fenêtre de diagnostic uniquement : `run --duration 60`.
En fenêtre : cliquer l'objet ou « Ouvrir l’objet », puis animer, activer le halo,
mettre en pause et reprendre. Fermer la fenêtre ou « Quitter la sonde » termine
le processus. La durée est bornée à 1–600 secondes, 60 par défaut.

Essais distincts, à lancer un par un :

```sh
sh pocs/macos-surface/probe.sh run --smoke --snapshot --duration 6
sh pocs/macos-surface/probe.sh desktop --smoke --duration 6
```

Le smoke de fenêtre actionne les boutons par code, pas par injection souris. Il échoue si
l'animation demandée ne progresse pas quand les animations sont autorisées.
Le smoke de bureau actionne le menu et les handlers de transition par code :
il teste la conservation de surface/état, pas le mouvement réel du compositeur.
`motion_observed_in_ticks` distingue une animation exécutée d'une animation seulement demandée.
`--snapshot` capture uniquement notre NSView et exige `--smoke` en mode fenêtre.
Le rendu des contrôles natifs dans cette capture hors écran peut être incomplet ;
elle ne remplace pas l'inspection d'une fenêtre visible.

La surface de fond ignore entièrement la souris, ne devient ni fenêtre clé ni fenêtre
principale et ne demande pas d'activation. Son menu reçoit des actions explicites.
Seul le bouton Finder explicite modifie sa préférence d'affichage réversible ; aucune
modification n'a lieu au lancement, pendant les tests ou sans clic utilisateur.

Le pacing accepte la visibilité AppKit ; sinon, il utilise le repli déclaré
« Finder au premier plan + surface ordonnée sur Space actif ». Ce repli n'est pas
une mesure exacte d'occlusion. Si une autre application masque le fond, l'animation
peut rester suspendue jusqu'au retour sur le bureau. Veille écran, session inactive,
pause et réglage système de réduction des animations restent prioritaires.
La dernière image reste conservée pendant la suspension ; la phase n'est pas remise
à zéro. Le test s'arrête toujours à sa durée limite, indiquée dans le menu WP.

Le lanceur sélectionne le SDK Xcode local sans modifier `SDKROOT` globalement.
Builds et caches SwiftPM sont dirigés sous `dist/pocs/macos-surface/`. Le runtime
ne crée un fichier que pour une capture demandée : export still près de la .app,
ou snapshot de fenêtre avec nom UUID dans son répertoire
courant, que le lanceur fixe à ce même dossier. Un lancement direct du binaire
ne garantit pas ce répertoire. Les caches système du compilateur ne sont pas
une frontière de sécurité. Aucun nettoyage automatique n'est effectué.

Le reçu JSON final va sur stdout ; les logs de build vont sur stderr.
Avec `desktop`, une application locale est assemblée au chemin stable
`dist/pocs/macos-surface/stable/Wallpaper Desktop PoC.app`, puis lancée en
arrière-plan par macOS. Cette stabilité évite de changer de localisation TCC à chaque
lancement. Le build reste signé ad hoc : modifier l'exécutable peut exiger de renouveler
l'autorisation Accessibilité. Le dossier conserve `receipt.json` et `stderr.log`. Le lanceur attend sa fin et
reprend le code du reçu ; l'absence de reçu échoue. Un Ctrl-C du lanceur `open`
ne garantit pas l'arrêt de l'application : elle garde sa durée limite propre.
Le bundle est de développement, non notarié, jamais installé dans Applications.
Le double-clic de ce bundle, sans argument, sélectionne aussi le bureau passif.
Codes : 0 fin normale/tests smoke réussis, 1 smoke incomplet/échec interne,
2 arguments refusés en lancement direct. En `.app`, un refus avant émission du
reçu donne 1 côté lanceur ; le détail reste dans `stderr.log`.
Un arrêt forcé peut empêcher l'émission du reçu.
Les compteurs ne mesurent pas des watts. Aucun réseau, PTY, ROM, plugin ou IA.

Preuves et limites : [fiche L1](../../docs/pocs/macos-surface.md).
