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
Le dessin de test reste statique et passif, sans interface de terminal ni jeu.
Pour la fenêtre de diagnostic uniquement : `run --duration 60`.
En fenêtre : cliquer l'objet ou « Ouvrir l’objet », puis animer, activer le halo,
mettre en pause et reprendre. Fermer la fenêtre ou « Quitter la sonde » termine
le processus. La durée est bornée à 1–600 secondes, 60 par défaut.

Essais distincts, à lancer un par un :

```sh
sh pocs/macos-surface/probe.sh run --smoke --snapshot --duration 6
sh pocs/macos-surface/probe.sh run --mode desktop --duration 10
```

Le smoke actionne les boutons par code, pas par injection souris. Il échoue si
l'animation demandée ne progresse pas quand les animations sont autorisées.
Une fenêtre signalée invisible suspend les ticks : ne pas contourner ce garde.
`--snapshot` capture uniquement notre NSView et exige `--smoke`.
Le rendu des contrôles natifs dans cette capture hors écran peut être incomplet ;
elle ne remplace pas l'inspection d'une fenêtre visible.

Le mode bureau ignore entièrement la souris, ne devient ni fenêtre clé ni fenêtre
principale et ne demande pas d'activation. Il ne teste aucune ancre interactive.
Il ne modifie ni fond système, ni Finder, ni permissions, ni démarrage de session.

Le lanceur sélectionne le SDK Xcode local sans modifier `SDKROOT` globalement.
Builds et caches SwiftPM sont dirigés sous `dist/pocs/macos-surface/`. Le runtime
ne crée un fichier que pour la capture demandée : nom UUID dans son répertoire
courant, que le lanceur fixe à ce même dossier. Un lancement direct du binaire
ne garantit pas ce répertoire. Les caches système du compilateur ne sont pas
une frontière de sécurité. Aucun nettoyage automatique n'est effectué.

Le reçu JSON final va sur stdout ; les logs de build vont sur stderr.
Avec `desktop`, une application locale est assemblée dans un dossier `desktop.*`
unique sous `dist/pocs/macos-surface/`, puis lancée en arrière-plan par macOS.
Ce dossier conserve `receipt.json` et `stderr.log`. Le lanceur attend sa fin et
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
