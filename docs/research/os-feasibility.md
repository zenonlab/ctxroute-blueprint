# Faisabilité OS avant adoption de la stack

Relevé du 7 septembre 2026. Étude des sources primaires et préflight local en
lecture seule ; aucun ancrage, hook, changement de permission ou benchmark exécuté.
Complète [la matrice de capacités](../architecture/runtime-infrastructure.md#matrice-de-qualification-par-fonctionnalité)
et [les essais B-O/B-R](../04-experimental-protocol.md). Ne remplace pas leurs critères.

## Verdict et niveaux de preuve

L'intégration doit être développée par le projet, avec des bibliothèques réutilisées.
La faisabilité dépend d'abord du shell et de ses permissions, ensuite de la capacité
du moteur à présenter sur sa surface. Compiler un moteur sur trois OS ne suffit pas.

- **Observé localement** : matériel et outillage listés ci-dessous seulement.
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
| Compilateur Apple | Swift 6.3.2 accessible via xcrun ; aucune compilation effectuée |
| Rust | Entrées cargo/rustc présentes dans PATH ; versions/toolchains pas encore vérifiées |
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

Restent à relever avant mesure : fréquence écran réellement configurée, échelle
logique, luminosité, profil basse consommation, conditions thermiques, charge de
fond, instruments utilisables et leurs droits. Ne pas déduire la fréquence réelle
des capacités commerciales de l'écran. Choisir explicitement le deployment target :
la présence du SDK 26.5 ne garantit pas l'exécution de toutes ses APIs sur macOS 26.2.

MAC-01 peut servir aux essais AppKit et Metal ainsi qu'à la comparaison terminal.
Il ne prouve ni D3cold sur portable hybride, ni Windows/Linux, ni un deuxième écran,
ni les versions minimales macOS de la future distribution.

## macOS : chemin candidat et points bloquants

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
Le message Progman/WorkerW reste non documenté. Examiner le code de la révision
retenue avant réutilisation ; le présent préflight n'en audite pas l'implémentation.

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

Les mécanismes candidats existent, mais aucune configuration n'a réussi B-O.
Le principal risque reste l'entrée sûre derrière les icônes ; le second est la
compatibilité du cycle de surface avec le moteur choisi. Les outils disponibles
sur MAC-01 permettent de préparer une sonde, sans garantir son résultat.

Avant code produit : choisir les budgets E1 et les versions de première livraison,
qualifier les instruments et terminer les décisions minimales d'initialisation.
Puis réaliser la sonde macOS passive, la variante avec ancre, et enfin la surface
du candidat graphique. Windows/Linux exigent des bancs accessibles avant une
adoption durable prétendant les couvrir. Voir la [revue de stack](stack-preflight.md).
