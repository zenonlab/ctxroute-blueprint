# Faisabilité OS avant adoption de la stack

Relevé du 7 septembre 2026. Étude des sources primaires et préflight local en
lecture seule ; aucun ancrage, hook, changement de permission ou benchmark exécuté.
Complète [la matrice de capacités](../architecture/runtime-infrastructure.md#matrice-de-qualification-par-fonctionnalité)
et [les essais B-O/B-R](../04-experimental-protocol.md). Ne remplace pas leurs critères.

## Verdict et niveaux de preuve

L'intégration doit être développée par le projet, avec des bibliothèques réutilisées.
La faisabilité dépend d'abord du shell et de ses permissions, ensuite de la capacité
du moteur à présenter sur sa surface. Compiler un moteur sur trois OS ne suffit pas.

- **Observé localement** : matériel, outillage et réponses des APIs sondées ci-dessous seulement.
- **Documenté amont** : API, protocole ou composant existant ; pas une preuve produit.
- **À expérimenter** : coexistence avec les icônes, énergie et reprise dans notre code.
- **Non disponible ici** : essais interactifs Windows/Linux, matériel hybride et
  autres configurations ; leur disponibilité chez l'utilisateur reste à préciser.

La bonne séquence est : contraintes OS → sonde native → surface du candidat
graphique → scène représentative → adoption. Les sondes ne doivent pas démarrer
terminal, conversion, simulation complète ou télémétrie système permanente.

## Premier banc observé : MAC-01

| Élément | Observation locale |
| --- | --- |
| OS exécuté | macOS 26.2, build 25C56, ARM64 |
| Modèle | MacBookPro18,3, Apple M1 Pro |
| CPU et mémoire | 8 cœurs rapportés (6 performance, 2 efficacité), 16 Go |
| GPU rapporté | Apple M1 Pro ; pas de dGPU distinct observé |
| Affichage | Un écran en ligne rapporté, principal, 3024 × 1964 pixels Retina |
| Alimentation au préflight | Batterie ; observation ponctuelle, pas profil de benchmark |
| SDK sélectionné | macOS SDK 26.5 via Xcode ; différent de l'OS exécuté |
| Compilateur Apple | Swift 6.3.2 via xcrun ; diagnostic natif exécuté, pas de compilation produit |
| Rust | rustc 1.97.1 et cargo 1.97.1 répondent ; installation automatique désactivée pendant le relevé |
| Instrument énergie | `/usr/bin/powermetrics` présent, aide consultée uniquement |

Commandes effectivement exécutées : `sw_vers`, `uname -m`, `xcode-select -p`,
`xcrun --sdk macosx --show-sdk-version`, `xcrun swift --version`,
`command -v cargo rustc powermetrics`, `pmset -g batt`, `powermetrics --help`.
Le résultat JSON de `system_profiler SPHardwareDataType SPDisplaysDataType -json`
a été filtré en mémoire avant affichage : seuls modèle, puce, mémoire, cœurs et
caractéristiques d'affichage ont été retenus. Aucun dump matériel brut, numéro
de série, UUID ou inventaire des fenêtres utilisateur n'est conservé dans le dépôt.

L'aide locale de powermetrics décrit des puissances **estimées** par sous-système,
pas un wattmètre exact par processus ; elle déconseille les comparaisons entre
appareils à partir de ces valeurs. Le banc devra mesurer une référence et un delta
sur la même machine, en conservant cette limite. Aucun prélèvement énergétique,
accès privilégié ni collecte des autres processus n'a été réalisé.

Restent à relever avant mesure : fréquence écran réellement configurée,
luminosité, profil basse consommation, conditions thermiques, charge de
fond, instruments utilisables et leurs droits. Ne pas déduire la fréquence réelle
des capacités commerciales de l'écran. Choisir explicitement le deployment target :
la présence du SDK 26.5 ne garantit pas l'exécution de toutes ses APIs sur macOS 26.2.

MAC-01 peut servir aux essais AppKit et Metal ainsi qu'à la comparaison terminal.
Il ne prouve ni D3cold sur portable hybride, ni Windows/Linux, ni un deuxième écran,
ni les versions minimales macOS de la future distribution.

## macOS : chemin candidat et points bloquants

### Diagnostic natif effectivement exécuté

Le 7 septembre 2026, une commande `xcrun swift -e` important AppKit, Metal,
CoreGraphics et Foundation a interrogé les APIs ci-dessous et sérialisé leur
résultat en JSON. Code de sortie 0. Aucun écran capturé, aucune fenêtre créée,
aucun event tap, aucun dialogue de permission et aucune frame rendue. Swift peut
alimenter ses caches de compilation ; aucun binaire produit n'a été ajouté.

| API / propriété | Réponse observée | Limite de la preuve |
| --- | --- | --- |
| NSScreen.screens, frame, backingScaleFactor | Un écran, 1512×982 points, facteur 2 | Repère local disponible ; hotplug et DPI mixte non testés |
| NSScreen.maximumFramesPerSecond | 120 | Maximum annoncé, pas taux courant ni framerate mesuré |
| MTLCopyAllDevices | Un Apple M1 Pro | Énumération Metal réussie ; surface et rendu non testés |
| MTLDevice.hasUnifiedMemory, isRemovable | true, false | Mémoire unifiée et GPU non amovible rapportés ; aucune garantie zero-copy |
| MTLDevice.isLowPower | false | Ce flag n'est pas une mesure de consommation ; ne pas rejeter automatiquement ce GPU |
| CGPreflightListenEventAccess | true | Vaut pour le contexte du diagnostic ; pas pour la future application signée |

Le SDK local définit `isLowPower` dans le contexte des systèmes à commutation
graphique, et `maximumFramesPerSecond` comme maximum supporté. Sources recoupées :
Metal.framework/Headers/MTLDevice.h et AppKit.framework/Headers/NSScreen.h.
L'observation de mémoire unifiée ne démontre pas le comportement d'un GPU dédié.

Reproduction du diagnostic exécuté, avec mise en forme lisible :

```sh
xcrun swift -e '
import AppKit
import Metal
import CoreGraphics
import Foundation
let screens = NSScreen.screens.enumerated().map { i,s -> [String:Any] in
    ["index":i, "width_points":s.frame.width, "height_points":s.frame.height,
     "scale":s.backingScaleFactor, "maximum_fps":s.maximumFramesPerSecond]
}
let devices = MTLCopyAllDevices().map { d -> [String:Any] in
    ["name":d.name, "low_power":d.isLowPower,
     "removable":d.isRemovable, "unified_memory":d.hasUnifiedMemory]
}
let data:[String:Any] = ["screens":screens, "metal_devices":devices,
    "event_listening_preflight":CGPreflightListenEventAccess(),
    "probe":"read-only; no window, event tap, prompt or rendering created"]
let out = try! JSONSerialization.data(withJSONObject:data, options:[.prettyPrinted,.sortedKeys])
print(String(data:out, encoding:.utf8)!)
'
```

Diagnostic seulement, pas un exemple de gestion d'erreurs applicative. L'exécution
des commandes `RUSTUP_AUTO_INSTALL=0 rustc --version` et
`RUSTUP_AUTO_INSTALL=0 cargo --version` a aussi confirmé la toolchain 1.97.1.
Cela satisfait numériquement les MSRV 1.93/1.90 relevées dans les manifests étudiés,
mais ne prouve pas un build compatible de l'ensemble des dépendances.

### Intégration à éprouver

Piste : fenêtre AppKit au niveau bureau, contenu graphique natif ; liaison depuis
Rust via [objc2](https://github.com/madsmtm/objc2) ou sonde AppKit minimale avant
intégration au moteur. Tester les deux étapes séparément pour identifier l'origine
d'un défaut : placement OS ou création de surface graphique.

La lecture des headers du SDK local confirme `NSWindow.ignoresMouseEvents`,
`occlusionState` et les fonctions `CGPreflightListenEventAccess` /
`CGRequestListenEventAccess`. Dans `NSWindow.h`, le commentaire de visibilité
mentionne les limites des boîtes englobantes et des fenêtres transparentes.
Ces déclarations prouvent la disponibilité dans le SDK, pas le résultat du bureau.
Références : [NSWindow](https://developer.apple.com/documentation/appkit/nswindow),
[occlusion visible](https://developer.apple.com/documentation/appkit/nswindow/occlusionstate-swift.struct/visible),
[préflight écoute](https://developer.apple.com/documentation/coregraphics/cgpreflightlisteneventaccess%28%29).
Les pages Apple étant partiellement rendues par JavaScript, les déclarations ont
été recoupées dans AppKit.framework/Headers/NSWindow.h et
CoreGraphics.framework/Headers/CGEvent.h du SDK sélectionné.

Preuves requises avant de retenir ce chemin :

- Niveau réellement visible sous Finder, sans masquer les icônes ni prendre le focus.
- Clic sur icône recouvrant une ancre : zéro action parasite ; distinction clic,
  double-clic, déplacement, rectangle et annulation du geste.
- Mode passif sans écoute globale ; variante interactive évaluée séparément. Ne pas
  confondre permission d'écoute, Accessibilité et capture d'écran. Ne demander aucun
  droit dont le mécanisme retenu n'a pas besoin ; refus et révocation doivent marcher.
- Spaces, Mission Control, plein écran, verrouillage et recréation de surface.
- Affichage statique sans soumissions périodiques, puis mesure de son coût résiduel.

Un `hitTest` de vue retournant nil ne prouve pas une traversée inter-applications.
Un numéro de fenêtre sous le pointeur ne suffit pas non plus à identifier une icône
Finder. Aucun suivi global ou test d'icône fiable n'est déclaré disponible ici.
Avant livraison : essai de l'application empaquetée/signée et vérification du
parcours de distribution, pas seulement du binaire lancé depuis un terminal.

## Windows : Explorer n'est pas une API de wallpaper stable

Piste : adaptateur Win32 spécifique, avec [Lively](https://github.com/rocksdanister/lively)
comme référence de réalisation, pas comme bibliothèque portable garantie.
Le message Progman/WorkerW reste non documenté. Une lecture ciblée du code amont
est consignée ci-dessous ; elle n'est ni un audit complet ni un essai Windows.

Deux pièges concrets doivent être exclus du prototype :

1. `SetParent` ne met pas automatiquement à jour les styles WS_CHILD/WS_POPUP.
   Des modes de DPI awareness différents peuvent entraîner erreurs ou changements
   de comportement. Tester avec Explorer et DPI mixtes, pas seulement entre deux
   fenêtres de notre application. [Microsoft SetParent](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent).
2. `LVM_HITTEST` reçoit un pointeur vers `LVHITTESTINFO`. Pour les messages hors
   plage système, SendMessage n'assure pas le marshalling entre processus. Le code
   initial envoyant l'adresse d'une structure locale directement à Explorer ne doit
   donc pas être repris tel quel. Choisir un mécanisme documenté/adapté et borné,
   ou signaler la capacité absente ; ne pas introduire une manipulation de mémoire
   distante comme correction automatique.
   [LVM_HITTEST](https://learn.microsoft.com/en-us/windows/win32/controls/lvm-hittest),
   [SendMessageW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagew).

Les limites de WS_EX_TRANSPARENT/HTTRANSPARENT restent celles de la
[synthèse des audits](architecture-audit-synthesis.md#entrées-et-ancrage).
Les callbacks d'entrée ne doivent pas effectuer de travail bloquant ni relayer
des commandes système directement. Explorer arrêté/redémarré, verrouillage,
écrans ajoutés/retirés et sessions avec droits différents font partie des tests.
Versions Windows et architectures CPU de première livraison restent à choisir.
Aucun test Windows n'a été réalisé dans cette session macOS.

### Lecture ciblée de Lively

À la révision `c1036feb664960722e34bf4309042c247d6a909d` :

- [SetupDesktopLayer](https://github.com/rocksdanister/lively/blob/c1036feb664960722e34bf4309042c247d6a909d/src/Lively/Lively/Core/WinDesktopCore.cs#L122)
  distingue une disposition avec ShellView en couche et une recherche de fenêtres
  sœurs. Le chemin examiné utilise 0x052C avec wParam 0xD et lParam 0x1 ; lParam 0
  de la recherche initiale n'est donc pas une recette universelle validée.
- [Destruction WorkerW](https://github.com/rocksdanister/lively/blob/c1036feb664960722e34bf4309042c247d6a909d/src/Lively/Lively/Core/WinDesktopCore.cs#L224)
  déclenche réinitialisation/réattachement selon le cas : tester le cycle du shell.
- [RawInputMsgWindow](https://github.com/rocksdanister/lively/blob/c1036feb664960722e34bf4309042c247d6a909d/src/Lively/Lively/Views/WindowMsg/RawInputMsgWindow.xaml.cs#L30)
  enregistre les périphériques et expose des événements souris. Son mode clavier
  n'est pas un besoin à importer dans notre wallpaper.

Lecture d'extraits pertinents, pas du dépôt entier. Elle prouve l'existence de
chemins concrets, pas notre filtrage d'icônes. Aucun code copié ou exécuté ; revue
des licences et de l'intégration requise avant réemploi.

Un hook WH_MOUSE_LL trop lent peut être retiré silencieusement par Windows.
Microsoft demande un retour rapide et propose Raw Input pour nombre d'usages.
La collecte d'un événement ne prouve pas que nous sommes autorisés à agir dessus.
[LowLevelMouseProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelmouseproc).

## Linux : qualification par compositeur

| Environnement | Piste documentée | Risque à lever avant choix du moteur |
| --- | --- | --- |
| KDE Plasma Wayland | Layer-shell ; intégration Plasma spécifique à comparer seulement si nécessaire | Le bureau/icônes peut recouvrir notre surface ; protocole présent ≠ clic accessible |
| Sway et autres wlroots | Client layer-shell via Smithay client toolkit | Pointeur disponible seulement selon routage des surfaces ; visibilité à examiner séparément |
| Autres compositeurs, dont COSMIC | Détecter les globals et qualifier leur implémentation | Ne pas hériter d'une certification KDE/Sway |
| GNOME Mutter Wayland | Repli annoncé ; extension distincte éventuelle | Layer-shell non pris en charge selon la documentation amont ; extension non adoptée |
| X11 | Fenêtre desktop et région d'entrée adaptées au gestionnaire de fenêtres | Coexistence avec le propriétaire du bureau et ses icônes ; pas preuve Wayland |

Sources : [compatibilité GTK4 layer-shell](https://github.com/wmww/gtk4-layer-shell#supported-desktops),
[protocole layer-shell](https://wayland.app/protocols/wlr-layer-shell-unstable-v1),
[Smithay client toolkit](https://github.com/Smithay/client-toolkit),
[EWMH Window Type](https://specifications.freedesktop.org/wm/latest/ar01s05.html).
EWMH décrit un type de fenêtre desktop ; ce n'est pas un passe-droit sur les
événements d'un gestionnaire d'icônes tiers.

Sur Wayland, créer la surface avec son rôle correct dès le départ et respecter
la séquence configure/ack/commit prévue par le protocole. Ne pas supposer qu'une
fenêtre xdg_toplevel créée par un framework peut recevoir en plus le rôle layer-shell.
Le [contrat de surface wgpu](https://docs.rs/wgpu/latest/wgpu/enum.SurfaceTargetUnsafe.html)
impose aussi des handles valides tant que la surface existe : l'adaptateur et le
backend graphique peuvent nécessiter une intégration privée commune, comme prévu
par C5. Ce n'est pas une raison pour contaminer le package avec ces handles.

Une région d'entrée vide n'offre pas le survol global. L'absence de frame callback
ou une fenêtre plein écran ne prouve pas à elle seule toute l'occlusion du bureau.
Relever les possibilités du compositeur, annoncer l'inconnu et appliquer le profil
de repli. Tester en session graphique réelle ; compilation CI, VM et compositeur
imbriqué sont utiles mais ne certifient pas l'énergie sur le matériel cible.

## Sortie de cette étude et prochaine preuve

### Activation du terminal : une demande, pas une garantie de focus

Un clic correctement reconnu ne garantit pas que le terminal puisse passer au
premier plan. Windows encadre SetForegroundWindow ; Wayland prévoit un jeton
d'activation que le compositeur peut refuser. La sélection logique d'une session,
la demande d'activation et son effet visible sont à tester séparément. Ne pas
annoncer « session affichée » seulement parce qu'un message IPC a été transmis.
[SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow),
[xdg-activation](https://wayland.app/protocols/xdg-activation-v1).

### Contraintes Wayland à appliquer dès la sonde

Une surface layer-shell ne doit pas avoir déjà un autre rôle ou un buffer attaché.
Après configuration du rôle : commit initial sans buffer, réception configure,
acknowledgement puis attachement du buffer. Cela exclut la simple conversion d'une
fenêtre xdg_toplevel déjà affichée. L'ordre entre plusieurs surfaces d'une même
couche n'est pas défini par layer-shell : tester leur coexistence réelle.
[Protocole layer-shell](https://wayland.app/protocols/wlr-layer-shell-unstable-v1).

La région d'entrée est distincte de l'opacité visuelle. `set_input_region(NULL)`
signifie région infinie ; utiliser un wl_region vide pour le mode passif. Une
surface transparente ne devient pas automatiquement traversable, et une surface
traversable ne reçoit pas automatiquement les mouvements du pointeur.
[Protocole wl_surface](https://wayland.freedesktop.org/docs/html/apa.html#protocol-spec-wl_surface-request-set_input_region).

### Bilan utilisable pour démarrer

Les mécanismes candidats existent, mais aucune configuration n'a réussi B-O.
Le principal risque reste l'entrée sûre derrière les icônes ; le second est la
compatibilité du cycle de surface avec le moteur choisi. Les outils disponibles
sur MAC-01 permettent de préparer une sonde, sans garantir son résultat.

Avant code produit : choisir les budgets E1 et les versions de première livraison,
qualifier les instruments et terminer les décisions minimales d'initialisation.
Puis réaliser la sonde macOS passive, la variante avec ancre, et enfin la surface
du candidat graphique. Windows/Linux exigent des bancs accessibles avant une
adoption durable prétendant les couvrir. Voir la [revue de stack](stack-preflight.md).
