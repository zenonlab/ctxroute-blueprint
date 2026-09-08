---
scope:
  - pocs/macos-connector/**
  - docs/architecture/platform-connectors.md
  - docs/architecture/src/platform-connectors.architecture.json
  - docs/session-handoff.md
  - .project/project-config.json
review: on-change
---
# ADR-0053 — Canal XPC nommé du provider au connecteur

- Status: accepted
- Date: 2026-09-08

## Context

Le provider natif ad hoc subit un refus System Policy sur `status.json`, même avec
le groupe local ; une sonde sandboxée lancée par le CLI n'avait pas reproduit ce
contexte. La découverte publique ExtensionFoundation n'a trouvé aucune identité
du provider depuis le CLI ni depuis un paquet de diagnostic portant l'identité app.
Cela ne prouve pas une impossibilité générale de découverte.

Un essai isolé a réussi un aller-retour NSXPCConnection depuis un client sandboxé
vers un service Mach launchd utilisateur. Son unique exception sandbox autorisait
la recherche de ce nom exact ; aucun réseau ou conteneur partagé n'était utilisé.
Le job éphémère a été arrêté après l'essai. L'intégration réelle est décrite plus bas.

## Decision

Le connecteur lui-même devient l'agent utilisateur XPC : pas de troisième démon.
Le provider se connecte vers `org.wallpaperthemes.connectorpoc2.agent`, ce qui permet
un démarrage à la demande. Le lancement normal reste sans fenêtre ; le diagnostic
reste une action explicite de barre des menus. Le job local est chargé par une
commande d'installation dédiée, sans modification de Finder ni service privilégié.

Conserver la sandbox du provider et ajouter seulement l'exception Mach lookup du
nom exact. Aucun droit réseau ni exception de fichiers. Avant export, l'agent
vérifie l'UID et fixe l'exigence de signature du provider embarqué avant `resume`.
Foundation contrôle l'identité du pair à chaque message, sans contrôle par PID. Le
provider épingle l'exigence de signature de l'agent embarquée lors du build.
L'agent est signé d'abord dans `Contents/Library/LoginItems/Wallpaper Connector Agent.app`,
puis son exigence est copiée dans les ressources du provider, qui est signé ensuite.
Le paquet extérieur est signé en dernier. Cet ordre évite une dépendance circulaire
entre signatures et la lecture du parent interdite par la sandbox du provider.
Le paquet extérieur est un lanceur ; seul l'agent héberge le connecteur en exécution.
Une signature ad hoc change à la reconstruction : les deux bundles sont remplacés
ensemble, sans confiance fondée uniquement sur un bundle ID ou un PID.

Échanges en mémoire : JSON Codable borné à 16 KiB, état poussé, commande et quittance
corrélées, une commande en vol. Les invariants d'expiration, d'instance et de
génération du modèle restent inchangés. La perte du lien invalide l'état affiché.
Le canal n'autorise que les actions du modèle ; aucune commande shell, chemin de
fichier du bureau ou donnée terminal n'y transite. Les vieux fichiers App Group
ne servent jamais de repli automatique ; les sondes historiques restent explicites.

## Consequences et validation

Le connecteur n'a plus besoin d'une autorisation App Group pour commander la scène.
Il dépend désormais d'un job Mach utilisateur et de sa lifecycle, à vérifier lors
du remplacement, de la fermeture de session et du redémarrage. Aucun succès
visuel ni support App Store n'est déduit de l'essai XPC isolé.
Qualifier : refus d'un pair étranger, identité de l'instance native, quittance
pause/reprise, reconnexion et absence de panneau automatique. L'entrée souris,
les deux contrôles du thème et la priorité Finder restent des preuves distinctes.

Preuve MAC-01, 8 septembre 2026 : build ad hoc `build.ov2G03` installé, agent
49867 et provider 49895 hébergé par macOS. Inspection puis pause, reprise,
accentuation et atténuation ont retourné des quittances corrélées (deux surfaces,
révisions 1 à 6), observées dans le diagnostic et le journal natif. Le job a ensuite
été relancé sans `--diagnostics`, sans arrêter le provider. L'effet visuel et le
refus d'un pair étranger ne sont pas déduits de ces reçus. Après relance discrète,
l'agent 50546 et le même provider confirment l'inspection révision 7 à 17:53:58.

Sources Apple : [NSXPCConnection vers un agent](https://developer.apple.com/documentation/foundation/nsxpcconnection/init(machservicename:options:)),
[exceptions sandbox](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/AppSandboxTemporaryExceptionEntitlements.html),
[protection App Group](https://developer.apple.com/forums/thread/721701).
