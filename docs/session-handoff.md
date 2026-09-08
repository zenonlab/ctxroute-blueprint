# Reprise de session — Wallpaper

## Verrou de personnalisation corrigé — 8 septembre 2026, 22:05

L'utilisateur confirme les deux boutons fixes de f8cQnv, mais décrit des objets
intermittents. Inspection native : `Personnaliser l’objet` restait ouverte ; le
guard global `!editor.isVisible` de `interact` rejetait alors toutes les intentions.
Ce guard est retiré, pas celui de validité du thème. `present` rappelle le brouillon
existant en activant l'app, sans réinitialisation ; fenêtre `moveToActiveSpace`.
Un autre objet attend Enregistrer/Annuler du brouillon courant. Aucun changement
du hit-test, du tap, de TCC, de XPC ou des frontières : diagramme inchangé.

Build signé **XgZtUb** installé, ancien f8cQnv conservé dans
`dist/pocs/macos-connector/modal-update.proHVj/previous-app.disabled`. Préflight
passé, même exigence de certificat vérifiée. Agent persistant **84656**, démarrage
normal sans diagnostic, **accessibility=true**. Ambre resélectionné par Computer Use :
provider **44892**, deux surfaces natives créées et quittance configure observées.
Pas de modification de droits ni du réglage Fichiers. Le contrôle GUI ne parvient
pas à inspecter l'agent sans fenêtre (timeout) : test de gestes demandé à l'utilisateur.

32 XCTest existants passent, compilation Swift 6 stricte, tests natifs injectés et
signature deep/strict passent ; `npm run verify` exit 0. Logs `/tmp/wallpaper-modal-`
`tests.log`, `build.log`, `install.log`, `verify.log`. Ces tests ne prouvent pas la
régression GUI résolue : rappel du brouillon, boutons pendant édition, fermeture /
réouverture et clics sur objets animés restent à qualifier. **PoC non validé**.

## f8cQnv installé — 8 septembre 2026, 21:37

Installation autonome demandée. Les clics Réglages échouaient (offscreen/noWindows).
`pluginkit -e ignore` seul n'empêchait pas WallpaperAgent de recréer le provider ;
tentative refusée par le préflight, élection `default` et ancien agent restaurés.
Seconde préparation : arrêt du job exact, désinscription de l'ancien provider,
désinscription LaunchServices, ancien paquet déplacé hors du chemin installé dans
`dist/pocs/macos-connector/update-hold.5EYqh8/previous-app.disabled`, puis arrêt du
provider PID 17798. Retour arrière prévu si le nouveau paquet n'était pas copié.
Préflight **passé**, installation f8cQnv terminée, pas de suppression. Signature
deep/strict et égalité du binaire installé/candidat vérifiées. Ne pas reconstruire.

Agent persistant initial PID 17973 : accessibility=false. Passage en diagnostic :
premier bootstrap échoue avec code 5 après bootout ; service ensuite absent, second
start réussi PID **18091**. Deux starts identiques gardent ce PID. La transition
de configuration de lancement reste à durcir ; ne pas affirmer une fiabilité totale.
Provider **18055** actif après réouverture via le bouton natif du connecteur puis
sélection Ambre. Diagnostic Ambre : **2 surfaces**, commandes XPC confirmées.
Les 0 surfaces du diagnostic Orbite correspondaient à un thème différent, pas à
l'absence du provider. Aucun clic sur le décor encore qualifié.

Accord utilisateur reçu : « acord granted » pour renouveler uniquement TCC de
Wallpaper Connector Agent. La sélection AX par clic tombait sur une mauvaise ligne ;
aucun retrait effectué sur cette ligne. Navigation clavier contrôlée jusqu'à la
ligne Wallpaper Connector Agent, puis Supprimer. Authentification native réalisée
par l'utilisateur, ancienne entrée retirée, puis ajout de l'agent au chemin installé
exact (URL vérifiée dans le sélecteur), interrupteur on. Aucun autre droit modifié.
Relance du même binaire via launchd : PID **18303**, 21:44:10 **accessibility=true**
et **tap-enabled**. Reconnexion XPC épinglée au provider 18055 observée à 21:44:36
(reprise différée de 30 secondes). Les clics avant cette reconnexion peuvent être
refusés faute de catalogue ; ce délai n'est pas une promesse de reprise instantanée.
Diagnostic masqué sans quitter l'agent. Computer Use refuse le bureau Finder avec
`cgWindowNotFound` ; une question demande clic son puis clic droit personnage pour
corréler les traces réelles. Fichiers : qualification des deux sens encore requise.
Le plist persistant sur disque est remis sans `--diagnostics` pour le prochain login,
sans redémarrer le job actuel : celui-ci conserve ses traces bornées pour le test.
Skill Computer Use employé ; aucune modification du code, des contrats ou diagrammes
pendant cette installation. État produit : **PoC non validé**.

## Récupération de capture — candidat du 8 septembre 2026, 21:23

Demande : conserver les zones invisibles synchronisées du PoC1 et vérifier les
références open source. Régression corrigée dans DesktopInput : un port existant
désactivé bloquait toute reprise ; la notification système n'appelait pas enable.
Réactivation différée hors callback, contrôlée par TCC/session/veille, idempotente,
et recréation d'un port invalide. Pas de nouveau calque ni de modification du
filtre Finder. Références et limites dans le README : Apple tapEnable, skhd,
Phosphene (provider existant), Plash (code actuel non publié).

Candidat **build.f8cQnv**, build signé terminé (exit 0), deep/strict vérifié et
requirement lié au certificat local `8F422B938988AFF3A82FD871B42A66CAE13F865F`.
17 cas de récupération injectée, 7 lanceur, 9 fichiers, 9 Finder et 3 thèmes passent.
32 XCTest passent, dont interruption de geste puis nouveau clic gauche/droit.
Ces tests ne créent pas de tap ni de geste natif. **PoC non validé**.
Gate final `npm run verify` : exit 0, `/tmp/wallpaper-tap-recovery-final-verify.log`.
Premier passage : dépassement du budget de latence du hook PreToolUse. Cache Swift
créé par le test sans scratch-path conservé (déplacé, non supprimé) dans
`dist/pocs/macos-connector/swift-test-cache-recovery`. Employer désormais la commande
README avec `--scratch-path`. Aucun seuil de vérification modifié.

Non installé : Computer Use observe encore **Ambre statique — PoC 2**. Une question
demande à l'utilisateur de laisser Noir sélectionné pour la migration propre.
Ancien VaWZIK inchangé, aucun arrêt forcé du provider, aucune modification TCC.
Installer f8cQnv, pas BdNKFb qui n'a pas cette reprise ; autoriser ensuite le paquet
installé, puis qualifier les boutons, fichiers dans les deux sens, Spaces et veille.
Ne pas reconstruire ce candidat après autorisation. Correction interne : frontières
inchangées ; le gate impose une annotation Archify « Reprise à qualifier ».
AGENTS, CLAUDE et hooks audités, inchangés.
Archify : showcase 9/9, zéro erreur/avertissement ; quatre tailles clair/sombre
sans débordement, captures sombres 1440×900 et 2048×1320 inspectées. Viewer fixe anglais.
Source SHA256 `c14a25f3dfc529c79abd488d2a0b33a8a8ed82f83f302c0a55094900ab5c1a92` ;
HTML `dist/architecture/platform-connectors.architecture.html`, SHA256
`c8e04e35d40171b9b45d5346a1825781198271cb34e9a6cbff9314136aed617b`.

## Démarrage durable et signature locale — 8 septembre 2026

Demande utilisateur : arrêter les régressions de clics à chaque relance/mise à jour.
Accord reçu (« oui ») pour créer un certificat local dédié puis autoriser la nouvelle
identité. `Wallpaper Local Development`, SHA1
`8F422B938988AFF3A82FD871B42A66CAE13F865F`, importé dans le trousseau login et approuvé
uniquement pour codeSign (pas TLS). Source OpenSSL publique versionnée ; sauvegarde
locale de clé/certificat sous Application Support/org.wallpaperthemes.connectorpoc2/signing,
hors dépôt, répertoire 0700 et clé 0600. Ne jamais journaliser ou committer cette clé.

`--sign-local` exige l'identité valide sans repli ad hoc. Test réel : deux codes
différents ont le même designated requirement et passent la vérification croisée.
Le garde-fou d'installation rejette une migration sans `--allow-identity-change`.
Cela ne prouve pas encore la persistance TCC entre deux mises à jour de l'app.

Le script start est maintenant idempotent et accepte `--persistent`. Job actif :
`~/Library/LaunchAgents/org.wallpaperthemes.connectorpoc2.agent.plist`, sans diagnostic,
RunAtLoad=true, KeepAlive/SuccessfulExit=false, ThrottleInterval=10. Deux starts ont
conservé PID 46850. Arrêt contrôlé SIGTERM de ce PID : reprise automatique PID 46948,
runs=2. Ce test porte sur le job avec **l'ancien paquet VaWZIK encore installé**.
Aucun logout/reboot testé. Quitter décharge le job ; le login suivant le recharge.

Code candidat : le véritable agent est démarré par launchd, sans la course avec le
lanceur LaunchServices transitoire. Un lancement direct est refusé (test exit 2).
Le lanceur recharge le plist persistant vérifié après Quitter. 7 cas natifs de
configuration passent, plus les 9 cas Finder et 9 cas Fichiers ; catalogue 3 thèmes.
31 XCTest passent. Aucun changement au filtrage des icônes ni aux intentions du thème.

Premier paquet signé **KJsOlG** construit et vérifié, mais installation refusée car
Lagon était redevenu actif et macOS recréait son provider. Ancien agent redémarré
sous le job persistant, aucune substitution forcée. Une question asynchrone demande
de laisser Noir sélectionné pendant la migration.
Dernier candidat **BdNKFb** inclut le rechargement après Quitter ; build terminé
(session exec 6151, exit 0) après validation du trousseau par l'utilisateur.
Signature deep/strict vérifiée ; requirement de l'agent lié au certificat ci-dessus.
Tests natifs : 7 lanceur + 9 fichiers + 9 Finder + catalogue 3 thèmes passent.
Toujours non installé : Réglages montre maintenant **Ambre statique — PoC 2**,
changé par l'utilisateur depuis Lagon. La tentative de sélection Noir est refusée
par Computer Use (`cannotClickOffscreenElement`). Aucun arrêt ni remplacement
forcé ; sélectionner manuellement un fond Apple reste nécessaire. Ne pas
reconstruire après l'autorisation TCC finale.

ADR-0055 + source Archify mis à jour : showcase 9/9, aucun avertissement ; source
SHA256 `989ec71d0092ecbd8fa5f45f782e9b1978357a2daa6341708e491fc4974c2ca9`, HTML
`7fda96271f8002791dac3e5e43eab79e7fa1bd629bc723a67948b0ad60159e24`.
Containment 4 tailles clair/sombre ; captures sombres petite/grande inspectées.
Viewer fixe anglais. AGENTS, CLAUDE, hooks inchangés ; aucune suppression.
Audit : démarrage/script/signature et tests conformes ; boutons, TCC du nouveau
paquet, login réel et mise à jour après autorisation restent à qualifier.

## VaWZIK installé — 8 septembre 2026, 20:21

L'utilisateur a sélectionné le fond Apple demandé. Le job exact de l'agent a été
arrêté, puis l'ancien provider PID 26818 terminé. Préflight passé, VaWZIK installé
sans reconstruction. Ancien g9pTbH conservé dans
`dist/pocs/macos-connector/replaced.agV4zz/previous-app.disabled`.
Signatures vérifiées et binaire installé identique au candidat.

Agent enregistré : `agent.aWdeAz`, PID **3095**, lancement normal launchctl avec
`--agent --diagnostics`. Journal 20:21:37 : **accessibility=false**. Un lancement
direct temporaire depuis l'outil terminal avait affiché true (PID 78886) ; ce
contexte ne prouve pas la permission du job macOS. Il a été terminé et ne doit pas
servir de contournement. Premier démarrage sorti sans diagnostic ; lancement du
job ensuite confirmé. Provider PID 5570 : configure appliqué, quittance reçue,
mais **0 surface active** tant que le fond Noir reste sélectionné.

Réglages relancés après installation : trois thèmes présents. Les clics automatisés
sur Ambre ne changent pas SelectedDesktop (toujours Noir). Le menu de statut Orbite
n'est pas exposé par l'outil de contrôle ; test réel du toggle non exécuté.
Préférences finales inchangées : StandardHideDesktopIcons=0, CreateDesktop=1.

Une question asynchrone demande l'accord pour renouveler uniquement l'entrée TCC
Wallpaper Connector Agent ; aucune réponse encore reçue, aucun droit modifié.
Prochaine étape : renouvellement autorisé + sélection Ambre, puis test masquer /
réafficher et récupération menu. Garder VaWZIK gelé après permission. Aucun code,
contrat ni diagramme changé dans cette installation ; seul le présent état évolue.

## Installation suspendue par l'interface macOS — 8 septembre 2026

Après demande d'installation autonome, le candidat VaWZIK passe encore `--check`.
Le thème réellement sélectionné est **Ambre statique**, et non Lagon. L'automatisation
voit les vignettes et capture les Réglages, mais refuse Noir et Sequoia avec
`cannotClickOffscreenElement` ; clic par coordonnées : `noWindowsAvailable`.
Relance complète des Réglages par leur menu, défilement, navigation clavier,
Raise et « Tout ramener au premier plan » ne résolvent pas le problème. Une capture
a aussi échoué avec SCStreamErrorDomain -3811. Aucun changement de fond confirmé.

Le provider PID 26818 et l'agent autorisé PID 27652 restent actifs au chemin installé.
Aucun arrêt, remplacement, changement TCC ou nouveau build. Ne pas affaiblir le
préflight : une sélection manuelle temporaire d'un fond Apple est nécessaire avant
de poursuivre l'installation de VaWZIK. Remettre ensuite Ambre statique et qualifier
les deux sens du contrôle Fichiers. Aucun contrat ni diagramme ne change ici.

## Fichiers du bureau — correctif candidat, 8 septembre 2026

**Retour utilisateur : les interactions fonctionnent sur g9pTbH**, sauf le bouton
Fichiers. Ce dernier ouvrait seulement les Réglages. PoC1 inspecté : CFPreferences
`CreateDesktop`, puis arrêt/reprise Finder. Non repris car le PoC2 nécessite une
cible AX Finder positive pour les clics ; aucun overlay n'a été ajouté.

Candidat **build.VaWZIK**, construit avec `build.sh --development`, pas installé.
`DesktopItems` écrit `StandardHideDesktopIcons` dans WindowManager, relit l'état,
signale les erreurs et refuse Stage Manager actif ou CreateDesktop=false. Toggle
et réaffichage explicite dans le menu natif Orbite, indépendants du wallpaper.
Ni fichiers déplacés/supprimés, ni arrêt Finder/Dock, ni polling, ni nouveau XPC.
Le PoC1 et le filtre d'entrée désormais fonctionnel restent intacts.

Preuves : 31 XCTest ; 9 cas injectés DesktopItems + 9 cas Finder ; catalogue natif
3 thèmes ; compilation Swift 6 stricte et signatures valides. Sur MAC-01, la case
native « Sur le bureau » suit StandardHideDesktopIcons (1 → 0 → 1), puis suit une
écriture directe vers 0. État initial rétabli : StandardHideDesktopIcons=0,
CreateDesktop=1, même Finder PID 26219. Pas de preuve du cycle visuel complet par
le bouton du candidat ni de conservation du hit-test après masquage.

L'app installée demeure g9pTbH, agent PID 27652 autorisé : ne pas la remplacer à
chaud. Prochaine étape : sélectionner temporairement un fond Apple, installer
VaWZIK via le préflight normal, renouveler TCC avec accord utilisateur si nécessaire,
puis geler ce binaire et qualifier masquer/réafficher depuis le bouton et le menu.
Ne pas annoncer le correctif déployé avant cette étape.

Schéma architecture : showcase 9/9 sans erreur/avertissement ; source SHA-256
`aa72d887cc5496fd31632c4f4bb7f810bd5fc739c5463f4c84f6be035da621a3`, HTML SHA-256
`d10454b8ee3a271a50eaded13e792fd416396aca6885220da655e0fe8a0d3051`.
Containment validé sur quatre résolutions, clair/sombre ; captures sombres 1440×900
et 2048×1320 inspectées. Viewer fixe en anglais.
`npm run verify` passe (code 0, `/tmp/wallpaper-desktop-items-verify.log`).
Audit doctrine : AGENTS/CLAUDE/hooks inchangés ; portée native locale, pas de nouvelle
dépendance. Preuve fonctionnelle manquante : installation et clics du candidat.

## Build corrigé autorisé — 8 septembre 2026, 19:59

Après accord explicite et authentifications réalisées par l'utilisateur, seule
l'entrée Accessibilité de Wallpaper Connector Agent a été renouvelée. Le sélecteur
avait conservé un chemin de sauvegarde : navigation vers le parent Library puis
LoginItems et relance complète des Réglages ont permis de sélectionner le chemin
installé exact. Aucun autre droit changé, aucun fichier supprimé.
Même build g9pTbH, sans reconstruction ; agent PID 27652, job `agent.1fu9Ns`.
Journal à 19:59:34 : `accessibility=true`, puis **`tap-enabled`**.
Cela prouve l'autorisation et la création du tap, pas le succès d'un geste.
Le panneau diagnostic a été masqué sans arrêter l'agent ; les traces bornées restent
actives. Les Réglages montrent encore le fond Apple Noir ; la sélection automatique
de Lagon échoue malgré une vignette visible (`cannotClickOffscreenElement`, puis
`noWindowsAvailable`). L'utilisateur est sollicité pour sélectionner Lagon et faire
un clic droit sur personnage / clic sur son. Lire ensuite les codes catégorie input
et les quittances XPC ; ne pas annoncer de clic réussi avant cette preuve.
Aucun code, contrat ou diagramme changé dans cette étape.

## Correctif Finder candidat — 8 septembre 2026, 19:47

Cause localisée : `FinderBackground` exigeait directement AXScrollArea alors que
la mesure documentée du premier PoC est AXGroup → AXScrollArea → AXApplication.
Le filtre reconnaît désormais cette chaîne exacte, sans promouvoir les descendants
d'icônes ; les enfants et leurs rectangles conservent la priorité. Neuf cas purs
testent fond, icône, fenêtre, application tierce et signatures inconnues.
Traces limitées à 32 codes fixes en mode explicite `--diagnostics` seulement.

Candidat `build.g9pTbH` : build strict, signatures et catalogue natif passent ;
31 XCTest passent ; `npm run verify` passe (code 0, log `/tmp/wallpaper-finder-verify.log`).
**Installé à 19:49 après intervention utilisateur** : les deux premières tentatives
étaient refusées car macOS recréait le provider. L'utilisateur a ensuite confirmé
le choix temporaire d'un fond Apple. Le provider restant PID 92964 a été arrêté,
le préflight a réussi, et l'ancien paquet a été conservé dans
`dist/pocs/macos-connector/replaced.zr4JcI/previous-app.disabled`.
Aucune suppression ni arrêt de service Apple. Agent corrigé PID 26766, job
`agent.ZxiHIQ`, lancé avec diagnostic temporaire pour tracer les gestes.
Journal : `Startup diagnostics=true accessibility=false` ; signature ad hoc modifiée.
Une nouvelle confirmation est demandée pour renouveler uniquement l'autorisation
du binaire corrigé. Ne pas reconstruire ensuite. Aucun clic réel validé sur ce build.
Audit : code/tests et installation conformes ; autorisation et qualification native
manquantes. AGENTS, CLAUDE et hooks inchangés. Le gate exige une annotation Archify
pour le filtre : topologie inchangée, tag « Filtre Finder à qualifier ».
Showcase 9/9, zéro erreur/avertissement ; source SHA-256
`ce7da6751c15818f03ef0106c5de40b25e65d6262051c595ad33c320fa539f48`, HTML SHA-256
`0d4b87c4b019452aeee4a09cf6c0e2677269e42694a7d3394a78adea6285cb73`.
Containment quatre résolutions clair/sombre validé ; captures sombres 1440×900 et
2048×1320 inspectées. Interface fixe du viewer en anglais, contenu rédigé en français.

## Permission renouvelée — 8 septembre 2026, 19:38

Après accord explicite (« go ») et authentification macOS réalisée par l'utilisateur,
l'entrée Accessibilité de **Wallpaper Connector Agent uniquement** a été retirée,
puis réajoutée via le chemin du paquet installé. Aucun fichier supprimé, aucun
autre droit modifié. La sélection initiale erronée de Codex Computer Use a été
détectée et corrigée au clavier avant toute suppression.

Le même build QjikMP, sans reconstruction, a été relancé avec `restart-agent.sh`.
Job `agent.YabCOR`, PID 9522 ; journal à 19:38:21 :
`Startup diagnostics=false accessibility=true desktop-input=capability-gated`.
Le blocage TCC est donc levé dans le processus réel, pas seulement dans les Réglages.
Les statuts `accessibility=false` et confirmation en attente ci-dessous sont historiques.
Le contrôle UI de l'agent installé expire ; pas de preuve automatisée de clic bureau.
Le journal consulté après relance ne montre pas encore de nouvelle quittance XPC.
La réception des layouts, le filtrage Finder et les gestes restent à qualifier :
ne pas confondre autorisation et succès fonctionnel. Aucun code ou diagramme changé.

## Installation effective — 8 septembre 2026, 19:30

Le candidat `build.QjikMP` est maintenant **installé** dans
`~/Applications/Wallpaper Themes/Wallpaper Connector PoC 2.app`.
Cette preuve remplace le statut « Non installé » des étapes historiques ci-dessous.
Le job agent a été arrêté et seul notre provider PID 72851, identifié par son
exécutable installé, a reçu SIGTERM. Le préflight normal a ensuite réussi.
Aucun processus Finder ou WallpaperAgent Apple n'a été arrêté.
L'ancien paquet est conservé dans
`dist/pocs/macos-connector/replaced.oHAMYe/previous-app.disabled` ; aucune suppression.

Relance normale sans diagnostic : agent PID 85230, job `agent.DOOvFJ`.
Le journal à 19:30:35 indique **`accessibility=false`** : les clics restent bloqués.
À 19:30:50, le nouveau provider PID 85385 initialise deux surfaces natives et
applique `configure`, génération 1. L'agent confirme la quittance correspondante.
La quittance affiche toutefois `surfaces=0` : elle ne constitue pas une preuve
de rendu visible ou de géométrie interactive correctement reçue par l'agent.
Ne pas annoncer une validation visuelle ou des gestes à partir de ces seuls logs.

Une confirmation distincte est en attente pour retirer uniquement l'entrée
Accessibilité périmée de Wallpaper Connector Agent et réajouter le binaire installé.
Aucune permission n'a été modifiée dans cette étape. Conserver ce même binaire
pendant la qualification ; ne pas reconstruire après une nouvelle autorisation.
Prochaine action : accord pour renouveler cette entrée, puis vérifier le démarrage
`accessibility=true` et tester les gestes réels avec priorité aux icônes Finder.
Le toggle fichiers demeure incomplet (ouvre les Réglages) et les fixtures audio
sont silencieuses. La structure séparée ne vaut pas validation fonctionnelle.
Cette étape ne change ni le code ni les frontières : aucun diagramme à modifier.

## Demande courante — boutons carrés Lucide, 8 septembre 2026

L'utilisateur rejette le résultat interactif et demande uniquement des icônes dans
des carrés pour le son et les fichiers. Aucune permission n'a été modifiée dans
cette étape ; aucune confirmation de retrait/réajout TCC n'a été reçue.

Build candidat `build.QjikMP` : boutons 40×40 en haut à gauche, espace 8 points,
icônes 24×24 adaptées de Lucide 0.468.0. Tracés natifs CAShapeLayer et licence dans
les trois bundles, sans nouvelle bibliothèque runtime ni fenêtre superposée.
31 XCTest passent ; build strict, catalogue Apple et signatures passent. Le PNG
Orbite produit par le vrai renderer a été inspecté : les deux icônes sont présentes
sans libellé. Cela prouve la présentation hors écran, pas les clics du bureau.

**Non installé** : l'inspection montre Orbite sélectionné ; les tentatives de
transition temporaire vers le fond natif Noir sont refusées `cannotClickOffscreenElement`
ou signalent une fenêtre modifiée. Aucune transition confirmée, aucun service arrêté.
Ne pas recommencer les mêmes clics en boucle ni remplacer le paquet actif en force.
Le source `DesktopInput` reste inchangé ; les blocages précédents (TCC et priorité
Finder à qualifier) restent ouverts. Le bouton fichiers ouvre encore les Réglages,
ce n'est pas le show/hide effectif demandé. Ne pas présenter cette tranche comme
une réparation complète des interactions.

Audit : CONFORME pour les 31 tests, le build signé, la licence embarquée, le rendu
hors écran et `npm run verify` (code 0). MANQUE : installation, preuve native des
clics et toggle Finder. Aucun hook, AGENTS ou CLAUDE modifié. Archify showcase 9/9,
zéro erreur/avertissement ; quatre résolutions sans débordement, captures sombres
1440×900 et 2048×1320 inspectées. L'UI fixe du viewer reste anglaise. Le schéma situe
les icônes dans l'hôte existant, sans nouvelle frontière d'exécution.

## Relance et permission périmée — 8 septembre 2026, 19:06

Le même build installé `zCjZT3` a été relancé sans diagnostic ni reconstruction.
Relance à 19:06 : PID 17807, job `agent.fSn6xg`. Après l'essai d'installation
ci-dessous, le même paquet est relancé par le job `agent.8d6lwo`.
Aucun service Apple arrêté.
Les Réglages montrent maintenant `Wallpaper Connector Agent` **on**, mais le
journal de démarrage indique encore `accessibility=false`.
Preuve TCC explicite : `Failed to match existing code requirement`, ancienne
exigence `478df1f9667818d0408bc6cd65dce834db61c082`, binaire installé
`b1d2dc6a6823b10a93f0e32a03a7e4338998563f` (confirmé par `codesign -dr -`).
Ce n'est donc plus une simple case décochée. L'ajout du chemin installé par le
bouton Ajouter, puis la désactivation/réactivation de cette seule permission,
n'ont pas renouvelé l'exigence : même refus après relance à 19:06:40.

Une confirmation distincte a été demandée pour **retirer l'entrée périmée puis
réajouter immédiatement le même agent installé**. Ne pas supprimer cette entrée
sans réponse, ni modifier directement TCC, ni emprunter l'identité du PoC1.
Aucun fichier ou entrée n'a été supprimé ; les autres droits restent inchangés.
L'inspection Finder échoue `cgWindowNotFound` ; les Réglages renvoient aussi des
erreurs intermittentes `noWindowsAvailable`/ScreenCaptureKit `-3811`.
Le catalogue affiche toujours Orbite, Lagon et Ambre, ce dernier sélectionné ;
aucune nouvelle sélection ni preuve de clic bureau n'a été obtenue.
Le provider `WallpaperProvider` PID 72851 reste présent et n'a pas été redémarré.
Sa présence seule ne prouve ni une nouvelle quittance ni le rendu actif.
Prochaine action : renouveler l'entrée avec accord, vérifier **dans le processus**
`accessibility=true`, puis qualifier boutons/clic droit et priorité Finder.
### Correctif ABI découvert pendant la relance

Le journal de `WallpaperProvider` à 19:07:41 révèle une seconde anomalie :
`isChoiceDownloadedWith:reply:` refuse un message, car le bloc reçu attend un
`NSNumber` alors que le pont déclare un `BOOL`. Le pont Objective-C et son handler
Swift ont été corrigés ensemble vers `NSNumber?`. Cela ne touche ni le contrat
produit ni la topologie. Le gate de commit requiert néanmoins une trace pour la
signature modifiée : le schéma existant porte l'annotation macOS `ABI à qualifier`.
Archify : showcase 9/9, zéro erreur/avertissement, containment quatre résolutions,
captures sombres 1440×900 et 2048×1320 inspectées. UI fixe du viewer en anglais.

Build candidat `build.yTrzh9` : compilation stricte, catalogue Apple trois thèmes
et signatures passent. `cmp` confirme que l'agent est identique à celui installé,
y compris son exigence `b1d2dc6a6823b10a93f0e32a03a7e4338998563f`.
**Non installé** : le préflight refuse le provider courant encore actif ; aucun
paquet remplacé. L'agent installé zCjZT3 a été relancé après ce refus. La transition
via les Réglages reste non exécutée à cause des erreurs de contrôle UI. Ne pas
annoncer l'ABI corrigée en production tant que le candidat n'est pas installé et
qu'une nouvelle sélection ne confirme pas l'absence du rejet XPC.

Vérification du correctif : 30 XCTest, zéro échec ; build strict/catalogue/signatures
passent. Le cache Swift de cette passe a été déplacé sous `dist/pocs/macos-connector/`
sans suppression. `npm run verify` final passe (code 0) ; une passe précédente
a été relancée après une course avec ce déplacement du cache pendant le scan.
Audit doctrine : CONFORME pour le delta local, la documentation
des preuves et la préservation du paquet ; MANQUE pour installation/gestes natifs ;
N/A pour une nouvelle architecture. AGENTS, CLAUDE et hooks restent inchangés.

## État courant — comparaison PoC1 et reprise des gestes, 8 septembre 2026

Dernière demande : comparer le PoC1, corriger les boutons et continuer en autonomie.
Constat réel dans Confidentialité et sécurité → Accessibilité, à 18:54 :
`Wallpaper Desktop PoC` est **on**, `Wallpaper Connector Agent` est **off**.
Une confirmation explicite pour activer ce dernier a été demandée ; ne pas
interpréter l'autonomie générale comme un consentement à ce droit système.
Aucun droit ni base TCC n'a été modifié. Le menu Activer appelle maintenant la
demande Apple seulement après action utilisateur ; les Réglages ont été ouverts
manuellement pour vérifier l'état, pas pour accorder le droit.

Comparaison code : le PoC1 avait des fenêtres d'entrée transparentes
`SplitDesktopControls` avec `acceptsFirstMouse`, mais déclarait la superposition
Finder non supportée. Son autre chemin était déjà un `CGEventTap` soumis à TCC.
Le PoC2 reprend ses notifications NSWorkspace pour retenter l'installation au
retour des Réglages même si l'agent reste invisible. Il annule les gestes sur
changement de Space/application, veille et session inactive. Pas de nouvel overlay.

**Binaire à conserver pendant la qualification : `build.zCjZT3`**, installé à la
destination habituelle. Agent 72704 (`agent.UtSysh`, mode diagnostic de test),
provider 72851 ; deux surfaces acquises à 18:54:19. Précédent sauvegardé dans
`replaced.30sUgD/previous-app.disabled`. Ne pas installer `build.GXHpaP` : variante
de lien Réglages abandonnée ; le source est revenu à zCjZT3. Recompiler changerait
l'identité ad hoc et pourrait invalider le prochain consentement.
Le thème observé dans macOS lors de cette comparaison est Ambre statique ; ne pas
le confondre avec une panne d'animation. La personnalisation Orbite reste locale.
Prochaine action : après accord, activer le droit du bon paquet et vérifier le
tap puis la vraie cible Finder avant toute déclaration de clic fonctionnel.

## Modale et gestes implémentés — preuve précédente

ADR-0054 : clic droit sur objet → modale centrée, jamais panneau latéral ; gauche
→ application locale ; droit sur vide qualifié → ajout. Implémentation dans
`CustomizationModal`, `DesktopInput`, `ThemeLayout`, `ThemeStore`. Pas de nouvel
overlay, dépendance, shell ni modification des fixtures signées. Annuler garde le
brouillon local ; Enregistrer valide, reçoit une quittance et persiste en Application
Support. La progression de l'animation est conservée après édition/redimensionnement.

Preuve native sur `build.lMgUtc` : modale inspectée visuellement et par AX ; le
brouillon « À annuler » disparaît après Annuler/réouverture. Enregistrer la valeur
Terminal sur le premier objet Orbite reçoit `configure/applied`, révision 2 à
18:40:44, puis écrit un JSON local mode 0600. Les deux surfaces restent présentes.
La modale a été ouverte par le menu de récupération (Cmd-E), **pas par le clic
droit bureau** : l'agent indique encore `accessibility=false`.

Cas réel détecté : deux surfaces actives 1512×982 sur display 1. `build.jbB7KU`
ajoute le consensus des hit-tests : toutes les représentations candidates doivent
viser le même thème et la même cible ; un désaccord reste natif. Ne jamais choisir
arbitrairement une surface, ni promettre que TCC seul suffit à qualifier Finder.
Ce build est installé à la destination habituelle. L'ancien paquet est conservé
dans `dist/pocs/macos-connector/replaced.bxqJQP/previous-app.disabled`. Agent 53479,
job `agent.Ut8S6M`, relancé sans diagnostic à 18:43:30. Aucune suppression, aucun
arrêt de Finder/WallpaperAgent, aucun changement de préférence Finder ni de TCC.

Qualification restante : autorisation TCC explicite demandée à l'utilisateur,
classification du bureau Finder réel, icône superposée, gauche/droit/ajout,
glisser, Spaces et énergie. `Fichiers…` ouvre les Réglages, pas un toggle ; les
fixtures restent silencieuses et mute ne change pas le volume système.

Vérification : 30 XCTest et build ad hoc strict/catalogue/signatures passent.
Le gate `npm run verify` passe après le consensus puis après la reprise NSWorkspace
(code 0 dans les deux cas). 30 XCTest et le build strict zCjZT3 passent.
Archify showcase 9/9, zéro erreur/avertissement, quatre
résolutions, captures sombres 1440×900 et 2048×1320 inspectées. L'UI fixe du viewer
reste anglaise. Doctrine AGENTS/CLAUDE et hooks inchangés ; audit stack : manque
la preuve du clic bureau, pas la modale ni la commande de configuration.

## Historique — redémarrage et diagnostic, 8 septembre 2026, 18:08

Build `build.LGtR5e` installé à la même destination ; précédent conservé dans
`dist/pocs/macos-connector/replaced.VsCv0Q/previous-app.disabled`. Aucun fichier
supprimé, aucun arrêt de Finder/WallpaperAgent ni changement de préférences Finder.
Agent relancé sans diagnostic, PID 96273 ; provider PID 85622, deux surfaces et
inspection/quittance révision 1 à 18:08:17. Le catalogue a nécessité une nouvelle
inscription `pluginkit -a` puis fermeture/réouverture réelle des Réglages Système.
L'inscription venait de disparaître après le remplacement : ne pas se fier à la
seule sortie immédiate d'installation. Aucun clic sur une icône de thème n'a été simulé.

`restart-agent.sh <app>` valide signature et chemin du job avant arrêt/recréation,
sans toucher au provider. Test réel : un paquet différent est refusé ; le paquet
installé redémarre sans panneau. Le nouveau `--check` valide les trois signatures,
le manifeste et l'épinglage XPC ; il n'ouvre plus l'ancien App Group. Il affiche
`provider=unconfirmed`, jamais un faux état vivant. Le build exécute ce contrôle.

Preuve de permission : log `Startup diagnostics=false accessibility=false
desktop-input=not-implemented`. L'ancien consentement utilisateur ne constitue donc
pas une autorisation effective de cet agent. Aucune demande de permission automatique.
**Reste à implémenter : les deux boutons et les gestes du bureau.** L'autorisation
seule ne les fera pas fonctionner. La priorité Finder et l'effet animé visible
ne sont pas qualifiés par les reçus. Ne pas annoncer « tout fonctionne ».
Ce correctif reste dans les composants existants : pas de nouvelle frontière,
dépendance ou permission accordée. Le gate de commit exige un placement du script :
le diagramme connecteurs précise la reprise isolée de l'agent, sans nouvelle topologie.

Audit : CONFORME — compilation stricte, contrôle XPC du paquet ad hoc, 24 XCTest,
`npm run verify` code 0, refus réel du redémarrage d'un autre paquet, revue du diff
et doctrine/hooks inchangés. MANQUE — deux contrôles, adaptateur de clics et preuve
visuelle/énergétique. Archify : showcase 9/9, zéro erreur/avertissement, containment
quatre résolutions et captures sombres 1440×900/2048×1320 inspectées.
N/A — nouvelle topologie, migration de données ou dépendance.

## Historique — transport natif débloqué, 8 septembre 2026

Demande produit inchangée : aucune modal de connecteur au lancement ; deux contrôles
en haut à gauche ; gauche = ouvrir/lancer ; droite = personnaliser, ou ajouter sur
vide confirmé. **Ces contrôles et gestes du bureau ne sont pas encore raccordés.**

Le refus System Policy App Group du provider est contourné architecturalement par
un canal XPC nommé, sans retirer la sandbox et sans demander de certificat développeur.
Voir ADR-0053. Agent signé avant provider, exigence de signature embarquée, lanceur
signé en dernier. JSON borné en mémoire, pas de fichiers runtime ni signaux Darwin.
Exception Mach lookup limitée à `org.wallpaperthemes.connectorpoc2.agent`.

Build installé : `dist/pocs/macos-connector/build.ov2G03/Wallpaper Connector PoC 2.app`.
Destination : `~/Applications/Wallpaper Themes/Wallpaper Connector PoC 2.app`.
L'agent est dans `Contents/Library/LoginItems/Wallpaper Connector Agent.app`.
Anciennes apps conservées dans `replaced.FhW9oW` et `replaced.pPrTxV`, sous `dist/pocs/macos-connector`.
Aucun fichier supprimé, aucun réglage Finder modifié, aucun service Apple arrêté.

Preuve native : Orbite sélectionné, provider 49895, deux surfaces. Le diagnostic
explicite de l'agent 49867 a reçu inspection, pause, reprise, accentuation et atténuation
(révisions 1 à 6). Les changements de libellés et les quittances sont observés dans
l'arbre AX ; les journaux natifs confirment les commandes. Cela ne prouve pas l'effet
visible sur le bureau : la capture Finder a échoué `cgWindowNotFound`.

Job relancé sans diagnostic : agent 50546, provider 49895 inchangé.
Plist éphémère : `dist/pocs/macos-connector/agent.YtVFl4/agent.plist`.
Arrêt exact : `launchctl bootout gui/501/org.wallpaperthemes.connectorpoc2.agent`.
Relance : `bash pocs/macos-connector/start-agent.sh` suivi du chemin installé.
Pas de plist dans LaunchAgents ni démarrage automatique à la prochaine session.
Le lanceur extérieur sans argument démarre le job déjà enregistré ; les sondes
`--check`/`--probe-mailbox` concernent l'ancien App Group, pas la disponibilité XPC.

23 XCTest passent (Swift 6), catalogue Apple trois thèmes et signatures vérifiés.
Reconnexion confirmée à 17:53:58 : même provider, nouvel agent, inspection révision 7
et quittance corrélée dans les deux journaux. L'inspection AX de l'agent sans fenêtre
expire (`timeoutReached`) ; ne pas en déduire un crash ni une preuve visuelle.
À poursuivre : pair étranger refusé, contrôle visuel natif,
puis étagère et gestes avec priorité Finder. Aucun succès complet du PoC2 annoncé.

Audit de cette étape : CONFORME — 23 XCTest, build strict et catalogue natif,
`npm run verify` code 0, diff vérifié, aucune suppression, doctrine/hooks inchangés.
Archify connecteurs : showcase 9/9, zéro erreur/avertissement, containment quatre
résolutions ; captures sombres 1440×900 et 2048×1320 inspectées, reçus dans
`architecture/platform-connectors.md`. MANQUE — test négatif de signature,
preuve visuelle du lancement discret, gestes/contrôles Finder et énergie.
N/A — nouvelle bibliothèque externe, persistance ROM/terminal ou changement PoC1.

## Historique — retrait du panneau automatique, 8 septembre 2026

Retour utilisateur : le panneau technique ne remplace ni les deux contrôles en haut
à gauche, ni le clic gauche d'action, ni le clic droit de personnalisation/ajout.
Ces interactions restent absentes du bureau réel. Ne pas présenter le PoC2 comme
une interface produit fonctionnelle.

Correctif `App/Main.swift` : lancement normal en mode accessoire, sans fenêtre ni
activation forcée ; diagnostic accessible à la demande dans la barre des menus.
Fermer le diagnostic laisse le connecteur actif. `--diagnostics` et `--smoke`
ouvrent explicitement la fenêtre. Pas de nouveau service de démarrage automatique,
ni de modification du transport, des permissions ou du contrat d'interaction.

Build vérifié mais NON INSTALLÉ :
`dist/pocs/macos-connector/build.vwLogo/Wallpaper Connector PoC 2.app`.
Compilation Swift stricte, signature/plists et catalogue Apple trois thèmes PASS ;
21 XCTest réussis. Les tests de modèle ne prouvent pas le comportement UI AppKit.
La tentative d'installation a été refusée par le préflight : le provider installé
a redémarré après SIGTERM (88715 observé). Aucun remplacement n'a eu lieu.
L'ancien compagnon a été arrêté ; ne pas le relancer, il ouvre encore son panneau.
La vérification UI du nouveau lancement reste à faire après installation sûre.
Le contrôle graphique a aussi rencontré une erreur ScreenCaptureKit -3811.

Prochaine étape : débloquer la publication native documentée ci-dessous, puis
raccorder effectivement l'étagère et les gestes. Cacher le diagnostic seul n'est
pas l'achèvement de la demande. Le gate exige une preuve de placement pour ce
changement : le schéma connecteurs précise « Diagnostic à la demande », sans
nouvelle frontière ni dépendance. Archify showcase 9/9, zéro erreur/avertissement,
containment quatre résolutions et captures sombres 1440×900/2048×1320 inspectées.
Audit : CONFORME pour compilation, 21 XCTest, `npm run verify` (code 0), revue du
diff et conservation des fichiers/réglages. MANQUE : installation et preuve UI du
démarrage discret, transport natif et interactions bureau. N/A : modification de
doctrine/hooks, nouvelle dépendance ou migration architecturale.

## Historique — redémarrage propre, 8 septembre 2026

À la demande « clean tout redémarre aux propres », contrôle préalable des Réglages :
`webzenon.background` sélectionné, et non plus Ambre. Les anciens providers
27759 et 49294 ont été arrêtés par SIGTERM après vérification de leurs exécutables.
Aucun arrêt de Finder/WallpaperAgent ni changement des préférences Finder.

Le build local `build.By7pIs` est maintenant installé dans
`~/Applications/Wallpaper Themes/Wallpaper Connector PoC 2.app`.
Installation : signature valide, catalogue Apple trois thèmes PASS, préflight PASS.
L'ancien paquet PoC2 est conservé dans
`dist/pocs/macos-connector/replaced.QgAkhP/previous-app.disabled`.
L'extension historique `org.wallpaperthemes.nativeprobe.controls.extension` a été
désenregistrée ; son app est conservée dans
`dist/pocs/macos-connector/retired.TX2w2g/Native Wallpaper Interactive.disabled`.
Aucun fichier supprimé. Ne pas relancer ces archives.

Contrôle après relance : un compagnon installé (79609), un provider installé (79777),
aucun `NativeWallpaperProbe` ni `SurfaceProbe`. Une seule inscription du provider
PoC2 observée, aucune inscription de l'ancienne extension `controls`.
Le connecteur reste ouvert avec ses commandes désactivées, sans faux succès.
Orbite n'est pas confirmé sélectionné : les actions UI sur le catalogue restent
peu fiables ; le dernier fond confirmé reste `webzenon.background`.

**Blocage natif désormais observé, et non supposé** : le nouveau provider écrit
`Cannot publish provider status`. Le journal kernel du 8 septembre à 16:56:00
confirme `WallpaperProvider(79777) deny(1) file-write-create` pour
`group.org.wallpaperthemes.connectorpoc2.local/Connector-v1/status.json`.
La sonde CLI locale réussit toujours ; elle ne prouve pas l'accès sous WallpaperAgent.
Ne pas annoncer le transport local qualifié, ni déduire qu'un certificat est la
seule solution. Prochaine étape : résoudre ce refus de publication sans retirer
la sandbox, puis obtenir une quittance et une action visible du vrai provider.
Ce nettoyage ne modifie ni code, ni contrat, ni diagramme. L'ancien état ci-dessous
décrit la préparation, pas l'installation actuelle.

## Historique — mode local sans certificat, 8 septembre 2026

L'utilisateur n'a pas de certificat Apple et a demandé le mode de développement.
`bash pocs/macos-connector/build.sh --development` compile un mode ad hoc explicite
avec groupe et notifications `.local` distincts. Mode strict et contrôle Team ID
préservés, pas de repli implicite, pas de sandbox retirée.

Build local : `dist/pocs/macos-connector/build.By7pIs/Wallpaper Connector PoC 2.app`.
21 XCTest passent. Catalogue Apple trois thèmes, signature ad hoc et plists passent.
Lancement CLI `--probe-mailbox` : code 0, lecture/écriture réelle dans le connecteur.
`test-sandbox-access.sh` : même résultat sous sandbox, paquet temporaire conservé
`dist/pocs/macos-connector/access.ZKSvLx/Transport Access Probe.app`.
Ces sondes n'envoient aucune commande ni signal Darwin. Elles écrivent seulement
un UUID dans `access-probe.json`, sans accéder aux données Finder.
Le provider réel reste NON QUALIFIÉ : les sondes CLI ne tournent pas dans WallpaperAgent.

Inspection des Réglages : « Ambre statique — PoC 2 » sélectionné, tous espaces activé.
L'utilisateur a donné son accord pour passer temporairement sur un fond macOS
standard, installer ce build local puis sélectionner Orbite. Ne pas redemander cet
accord. La tentative d'exécution est bloquée par le contrôle UI : l'arbre
d'accessibilité et la capture affichent le bouton « Noir », mais les clics renvoient
`cannotClickOffscreenElement` ou `noWindowsAvailable`. Les essais par coordonnées,
mise au premier plan et raccourci de fermeture n'ont pas confirmé de changement.
Ambre reste le dernier fond observé ; aucun remplacement ni lancement du nouveau
compagnon n'est confirmé. Ne pas déduire une action réussie d'une capture seule.
Le préflight retourne encore 2 avec `NativeWallpaperProbe, WallpaperProvider`.
Le CLI local `--probe-mailbox` retourne 0, mais toujours `provider=unconfirmed`.
Prochaine action : sélectionner manuellement un fond macOS standard et quitter
Réglages Système si le contrôle UI reste indisponible ; vérifier ensuite les
processus, installer le build local préservant l'ancien paquet, sélectionner Orbite
et qualifier une quittance corrélée avec une action visiblement appliquée.
Ne pas réinstaller par-dessus les deux anciens providers encore chargés et ne pas
arrêter WallpaperAgent/Finder. Ne pas réclamer un certificat pour ce mode local.
Audit final : CONFORME — 21 XCTest, builds local et strict, `npm run verify` à 0,
diff contrôlé, doctrine/hooks inchangés et aucune suppression. Le build strict
`build.jujiZ3` retourne bien 2 à `--probe-mailbox`, sans activer le mode local.
Archify connecteurs : showcase 9/9, zéro erreur/avertissement, containment quatre
résolutions ; captures sombres 1440×900 et 2048×1320 inspectées. Reçus dans
`architecture/platform-connectors.md`. MANQUE — échange avec le provider natif
et action visible, après déblocage du contrôle UI (accord déjà reçu).
Les 21 XCTest ont été relancés après cette tentative : zéro échec. Aucun code,
contrat, diagramme, hook ou réglage Finder n'a changé pendant cette tentative.
N/A — nouvelle dépendance/service ou nouvelle frontière architecturale.

## Historique — préparation de signature, 8 septembre 2026

Défaut corrigé : `build.sh` imposait l'ad hoc et le groupe était figé. Le mode
`--sign <empreinte SHA-1> <TEAMID>` sélectionne explicitement une identité existante,
génère le même groupe macOS préfixé par le Team ID dans les deux bundles et vérifie
leurs signatures. `Mailbox.shared()` vérifie le groupe dans les droits signés.
Aucun nouveau droit, serveur, overlay ou contournement de sandbox ajouté.

19 XCTest passent, dont cohérence groupe/équipe et refus des paramètres de signature.
Le refus d'une identité absente a aussi été vérifié (code 2, aucun repli).
Build ad hoc non installé : `dist/pocs/macos-connector/build.bJZCc6/Wallpaper Connector PoC 2.app`.
Compilation stricte, catalogue Apple trois thèmes, signatures/plists passent.
Le chemin signé et la preuve bouton → animation native restent BLOQUÉS faute
d'identité valide disponible. Ne pas confondre cette préparation avec M2-06 validé.
Une question sur l'identité Apple disponible a été envoyée ; aucun secret demandé.
Audit de clôture : CONFORME — périmètre et doctrine inchangés, aucun fichier supprimé,
aucun réglage/permission OS modifié ; revue du diff, 19 XCTest et build ad hoc réussis.
`npm run verify` sort à 0. Schéma connecteurs livré (showcase 9/9 sans erreur ni
avertissement), containment quatre résolutions et captures sombres 1440×900/2048×1320
inspectées ; les reçus SHA-256 figurent dans `architecture/platform-connectors.md`.
MANQUE — signature Apple effective, quittance et animation natives ; le trousseau
confirme toujours zéro identité valide. Les deux anciennes extensions subsistent,
aucun compagnon n'est relancé. N/A — nouveau service/dépendance ou conversion ROM.

## Historique — nettoyage et politique de gestes, 8 septembre 2026

Correctifs de revue en source : préflight anti-coexistence, tests de transport sans
notifications globales, conservation de quittance 30 secondes, diagnostic explicite
du transport non disponible sans Team ID, CI Swift et contrats de gestes D1-14–16.
Brief et roadmap sont réalignés : dépôt initialisé, PoC1 gelé, PoC2 incomplet.
Le nouveau build doit être qualifié séparément ; ne pas confondre code corrigé et
version installée. Aucun ancien mécanisme de clic ou de préférence Finder réutilisé.
Sans identité et droits adaptés, M2-06 reste bloqué. La politique de gestes D1 est
maintenant implémentée et testée isolément (`GestureRouter`, 8 tests), sans raccord
natif ni exécution d'action. Total : 17 XCTest. Ne pas annoncer des clics fonctionnels.
Les dernières modifications restent internes au modèle. Le gate exige une preuve
de placement pour les nouveaux modules : le dataflow de personnalisation précise
la responsabilité « gestes » dans la composition, sans nouvelle frontière.
Build de cette tranche, non installé :
`dist/pocs/macos-connector/build.v6Mjzm/Wallpaper Connector PoC 2.app`.
Compilation stricte, catalogue Apple trois thèmes, signatures et plists passent.
Le contrôle du trousseau confirme toujours zéro identité valide ; les deux extensions
historiques ci-dessous restent chargées, sans compagnon. Aucun réglage OS modifié.
Audit de clôture de cette tranche : CONFORME pour périmètre PoC2, absence de
suppression, doctrine et hooks inchangés, tests et documentation. `npm run verify`
sort à 0 : 262 tests Node passent, 1 ignoré, 0 échec ; 3 tests CRG passent,
audit npm sans vulnérabilité et diagrammes valides. Le sensor conserve 11 WARN,
sans ERROR/UNSAFE ; ce n'est pas un rapport sans avertissement.
MANQUE : preuve native du transport, des gestes et des capacités audio/Finder.
N/A : nouvel ADR, aucune frontière ou dépendance modifiée.
Le diagnostic compilé `--check` a retourné 2 avec le motif de signature, et
`--preflight-install` a retourné 2 en identifiant les deux providers résiduels.
Ces refus sont attendus ; ils ne sont pas une réussite du transport natif.
Vérification des correctifs : 9 XCTest, build Swift 6 avec catalogue Apple 3 thèmes,
signatures/plists et `npm run verify` passent. Build final non installé :
`dist/pocs/macos-connector/build.bzAcpO/Wallpaper Connector PoC 2.app`.
Diagramme de personnalisation : showcase 9/9, containment quatre résolutions,
captures sombres 1440×900 et 2048×1320 inspectées. Les preuves natives d'interaction
et d'énergie restent manquantes ; aucun succès fonctionnel n'est déduit de ce gate.

Les trois compagnons ont été arrêtés après vérification de leur chemin exécutable :
`WallpaperConnector`, `NativeWallpaperProbeHost` et `SurfaceProbe`. Le panneau
« Commandes de l’objet » provenait de `Wallpaper Desktop PoC`, pas du PoC2.
Aucun processus de ces trois compagnons ne subsiste au contrôle après arrêt.
Aucun LaunchAgent utilisateur correspondant ni service correspondant dans
`launchctl list` n'a été trouvé. Les extensions natives PoC1 et PoC2 restent
chargées par macOS : ne pas annoncer un retrait complet des wallpapers.

Aucun fichier, build ou réglage Finder n'a été supprimé/modifié. Aucun service
Apple n'a été arrêté. Ne relancer aucun ancien prototype automatiquement.
Le remplacement du fond expérimental par un fond macOS uni a été proposé à
l'utilisateur ; son accord reste attendu avant modification des Réglages.
Le retrait des extensions et l'archivage des applications installées restent à faire
après remplacement du fond ; les chemins ci-dessous décrivent l'historique.

La demande d'interface reste non implémentée : deux commandes discrètes en haut
à gauche (son du thème, fichiers bureau), clic gauche pour lancer l'action liée,
clic droit sur objet pour personnaliser, clic droit dans le vide pour ajouter.
Les icônes Finder doivent conserver la priorité. Le PoC2 passif et son transport
App Group bloqué ne constituent pas encore cette interface.
Ce nettoyage d'exécution ne change aucun contrat ni diagramme d'architecture.

## Historique technique — ne constitue pas une consigne de relancement

Mise à jour du 8 septembre 2026 : le PoC macOS 1 est gelé. Son dernier état comporte
deux représentations de panneau, deux fixtures et plusieurs chemins de diagnostic ;
ils restent utiles comme preuves mais ne forment pas l'application cible.

La nouvelle référence est l'[architecture des connecteurs](architecture/platform-connectors.md).
Le travail actuel est le [PoC macOS 2](pocs/macos-connector-poc2.md) : app connecteur
native, adaptateur wallpaper séparé, manifeste canonique et panneau logique unique.
Ne pas poursuivre `pocs/macos-surface/` ou `pocs/macos-native-wallpaper/` pour y ajouter
des fonctions produit. La première tranche est dans `pocs/macos-connector/` :
Foundation, Core Animation, app AppKit et extension native. Cinq XCTest passent,
build macOS 26 Swift 6 signé ad hoc. Correction du catalogue : champs privés `sortID`
et `shouldHideItemLabels`, test de décodage Apple intégré au build. Trois thèmes visibles
dans les Réglages : Orbite, Lagon, Ambre statique ; build 3 installé dans
`~/Applications/Wallpaper Themes/Wallpaper Connector PoC 2.app`.
Identité séparée `org.wallpaperthemes.connectorpoc2`. Orbite observé sélectionné par
l'utilisateur ; acquisition native par WallpaperAgent confirmée. Le contrôle distant
reste BLOQUÉ : refus sandbox de `status.json` dans l'App Group sans Team ID valide.
Ne plus déduire l'accès de l'extension à partir d'un `containerURL` obtenu dans l'app.
L'entrée reste passive, audio absent, toggle Finder indisponible avec accès aux
Réglages. Prochaine action : résoudre le transport/signature, puis qualifier M2-03,
M2-06 et M2-10 en session graphique. Ne pas confondre catalogue, acquisition et animation.

La personnalisation est cadrée séparément dans
[l'architecture de thème](architecture/theme-customization.md) et
[ADR-0050](decisions/ADR-0050-theme-customization-and-local-assets.md). Les boutons
AppKit observés restent diagnostiques. D1 éprouvera objets riggés, UI stylée et
résolution d'assets privés après stabilisation du manifeste M2-01.

[ADR-0051](decisions/ADR-0051-theme-system-control-shelf.md) ajoute l'étagère de
contrôles intégrée au thème : coin supérieur gauche par défaut, apparence libre,
actions runtime portables et `desktop.items.visible` négocié avec état confirmé.
Le toggle Finder historique ne doit pas être repris sans preuve de récupération.

Mise à jour : 7 septembre 2026. Dépôt initialisé ; L1 implémenté isolément.

## Reprise actuelle — qualification native

**8 septembre : animation build 3 confirmée par l'utilisateur.** Build interactif
5 séparé `compile.Bbw4WZ`, identités `.nativeprobe.interactive[.extension]`,
compilé/signé/enregistré sans modifier le fond actif ni arrêter PID 12860.
Compagnon AppKit avec sept commandes visuelles Darwin, panneau dans les calques,
pause/reprise et effet. 22 assertions d'état + 11 calques passent via `test.sh`.
Transport réel, rendu du panneau et clics non qualifiés ; pas de surveillance
globale. Demande d'accord pour compagnon souris/Accessibilité encore sans réponse.
Ne pas présenter cette étape comme terminal/jeux intégrés ou clics diégétiques
fonctionnels. Lire la fiche native pour chemins et protocole de test.

**Dernier résultat 23:57 : lancement rétabli après retour enregistré au build 3
`compile.nXn2Mw`.** PID 12860, chemin réel vérifié, journal `colorDiag installed
sweep` puis UPDATE. Build 4 aGAdKG conservé mais désenregistré ; ne pas le
substituer pendant la revue visuelle demandée à l'utilisateur. Aucun service
Apple arrêté. Les snapshots du build 3 échouent encore sur PNG/AVFoundation.
L'animation visible, les transitions et les clics restent à qualifier. Aucun
code produit modifié ; le retour concerne uniquement les registres du paquet.
Schéma inchangé : aucune nouvelle frontière implémentée. Voir fiche native.

Dernière contre-preuve : après resélection, toujours aucune animation selon
l'utilisateur. Les lancements échouent avec `Invalid bundle record for current process`
dans ExtensionFoundation ; chemin réellement lancé build 3 nXn2Mw malgré registre
build 4 aGAdKG. Hôte aGAdKG réenregistré via lsregister puis pluginkit, effet sur
le lancement encore non validé. Pas de nouveau build ni de bouton factice ajouté.
La demande de boutons/panneaux reste ouverte : route souris non établie dans
le protocole natif inspecté. Ne pas revenir à un overlay sans accord.

L'utilisateur rejette les fenêtres superposées ; ne pas poursuivre le split-input
comme s'il répondait au besoin. [ADR-0047](decisions/ADR-0047-native-wallpaper-extension-probe.md)
isole une préparation native Phosphene/ColorDiag, sans installer ni lancer l'extension.
Lire [la fiche native](pocs/macos-native-wallpaper.md) et utiliser son script compile-only.
Compilation directe possible ; Xcodebuild local échoue sur un plugin incompatible.
`prepare.sh --package` construit maintenant l'hôte et son `.appex` sandboxé avec
signature ad hoc vérifiée. Le dernier build est `compile.aGAdKG` (version 4).
Point d'entrée `_NSExtensionMain` corrigé : lancement XPC et apparition dans Réglages
observés par Computer Use. L'utilisateur a sélectionné le diagnostic puis signalé
un fond noir. Patch ColorDiag réellement appliqué depuis le build 3 ; snapshots PNG
via ImageIO/IOSurface corrigés au build 4, encore à vérifier en affichage réel.
Contrôle GUI de resélection indisponible ; une sélection utilisateur est demandée.
Ne pas annoncer l'animation ou les transitions validées. Voir la fiche native.
Les paragraphes suivants sont historiques.

## Historique — L1 en fenêtre

ADR-0046 ajoute `desktop --split-input --export-still --duration 180` : deux plans
de rendu/interaction inspirés d'Übersicht et export PNG préparatoire à la continuité.
Le fond système reste inchangé. 12 assertions smoke passent avec zéro mouseDown.
Le test prolongé séparé enregistre ensuite 40 mouseDown/40 actions et 403 ticks ;
Computer Use n'a cependant pas pu cibler le panneau ni qualifier le premier clic.
Priorité des icônes superposées
explicitement NON supportée par ce mode optionnel. Ne pas annoncer le défaut résolu.
Prochaine preuve : clic réel sur l'objet dégagé ; application du PNG seulement avec
accord pour le changement de fond système. Voir la section ADR-0046 de la fiche L1.

Version ADR-0045 : animation demandée en bureau, contrôles via menu **WP**, même
fenêtre conservée au retour Spaces/réveil. Les tests d'état et handlers passent,
pas encore la fluidité réelle des transitions. La sonde peut suspendre l'animation
si le fond est masqué ; voir `scheduling_source` dans le reçu. Clic sur géométrie
derrière les icônes toujours non qualifié. Lire la version actuelle de la fiche L1.

Lire [la fiche d'essai](pocs/macos-surface.md) et
[ADR-0043](decisions/ADR-0043-isolated-macos-surface-poc.md).
Source autonome : `pocs/macos-surface/`, aucun lien au futur moteur ou au terminal.
Les tests Swift passent ; le smoke AppKit ne valide pas l'animation dans cette
session où la fenêtre est signalée invisible. Ne pas forcer son exécution masquée.
ADR-0044 ajoute le vrai lancement de bureau par `.app` :
`sh pocs/macos-surface/probe.sh desktop --duration 60`.
La surface est reconnue et capturée par le contrôle macOS ; sa composition avec
les icônes Finder reste à qualifier. `run` reste uniquement le diagnostic en fenêtre.
Prochaine action : vérifier les gestes Finder. L2/L3, consommation électrique et
compatibilité OS restent ouverts. Voir la fiche pour les limites du contrôle GUI.

Les sections suivantes conservent les relevés documentaires antérieurs.

## Historique — avant implémentation L1

Lire en premier le [plan L1–L3](05-poc-start-plan.md) et
[ADR-0042](decisions/ADR-0042-bounded-poc-start.md). Sonde Swift/AppKit sur MAC-01,
contrôleur Rust sans GPU, puis scène wgpu/WGSL : choix expérimentaux seulement.
Les données sont originales, les sessions simulées et les actions locales bornées.
Prochaine action : terminer l'initialisation obligatoire puis implémenter L1.
Cette session corrige les documents ; elle ne livre aucun PoC ni benchmark.
Le statut `template` n'a pas été modifié. Ne pas annoncer E2 commencé.

Vérification de cette correction : `npm run verify` réussi, 262 tests réussis,
1 ignoré, 0 échec ; 3 tests d'intégration réussis ; audit npm sans vulnérabilité.
Ces résultats portent sur l'outillage. Aucun fichier supprimé, hook modifié ou
code produit ajouté. AGENTS.md, CLAUDE.md et hooks Codex inspectés, inchangés.
Workflow Archify livré : showcase 9/9, zéro erreur/avertissement, quatre tailles
sans débordement ; capture sombre 2048×1320 inspectée, revue humaine `pending`.
Libellés français, interface fixe en anglais ; artefact :
`dist/architecture/product-roadmap.workflow.html`.
SHA-256 source : `28d1c8e8744895702ebf5a1630aff08a5857eaef4850869fc750fb761ffdf446`.
SHA-256 HTML : `ac547c768f1a51a684bd2742a663860aa807b6f8999b11819ebda2187bee1052`.

Les paragraphes et reçus suivants décrivent les étapes antérieures :

Direction actuelle : [préparation IA et comportements](architecture/ai-prepared-behaviors.md),
[ADR-0041](decisions/ADR-0041-ai-prepared-selective-behaviors.md).
Données originales + contrôleurs adaptés en priorité ; portage original au cas
par cas. Entrées 2D/3D/hybrides/custom, sans liste fermée ni conversion garantie.
L'IA prépare les liens et tests hors runtime. La course conserve vrais virages,
formation stable et récupération visuelle sans relance implicite du travail.
États inconnus/périmés explicites ; aucune télémétrie déduite du seul silence PTY.
Prochaine étape : fermer E1 avec fixtures et périmètre minimal, puis E2 trajectoire
et formation sur données originales synthétiques. Pas de ROM nécessaire à cette
preuve ; OoT reste une étude, pas le point de passage de tous les jeux.

Vérification ADR-0041 : `npm run verify` réussi (262 tests réussis, 1 ignoré,
0 échec ; 3 intégrations réussies ; 0 vulnérabilité npm). 73 cibles de liens
locaux vérifiées, aucune absente ; `git diff --check` propre. Aucun fichier
supprimé, dépendance installée ou hook modifié. Aucun test produit exécuté.
Archify architecture : showcase 9/9, aucune erreur ni avertissement ; contrôle
automatique sur quatre tailles réussi ; capture sombre 2048×1320 inspectée.
Revue humaine `pending`, viewer anglais, libellés produit français.
Artefact : `dist/architecture/game-transformation.architecture.html`.
SHA-256 source : `952c57d60dde583eae62ab1b55e907b0211bbf6395716cec70d6e7634832104f`.
SHA-256 HTML : `ab657403aa0279747b39d777f33554e634b92ebeb4670cf80d7d07f5edeebffe`.

Les comptes rendus suivants sont historiques :

Dernière étude : [OoT vers un environnement interactif](research/oot-environment-pilot.md),
[ADR-0040](decisions/ADR-0040-source-engine-and-theme-runtime.md).
Sources publiques épinglées lues : OoT utilise une extraction Python, Shipwright
référence Torch, Fast64 décrit des limites d'import et des extensions glTF draft.
Temple du Temps est le cas provisoire, pas un jeu obligatoire ni certifié.
L'étude distingue données, code original dépendant du jeu et interactions créées.
Aucune ROM fournie/cherchée, aucun outil installé/exécuté, aucun bundle extrait.
E1 reste à fermer avant code ; V1–V6 cadrent l'intégration réelle ultérieure.
L'extraction privée nécessitera un chemin local fourni et une isolation qualifiée.

Vérification de l'étude : `npm run verify` réussi (262 tests réussis, 1 ignoré,
0 échec ; 3 intégrations réussies ; 0 vulnérabilité npm). Les 17 liens de fichiers
amont du rapport ont été revérifiés via raw HTTP 200 ; les cinq liens de dépôts
pointent sur les révisions relevées par API. Aucun test d'extraction produit.
Archify architecture : showcase 9/9, aucune erreur ni avertissement ; contrôle
de containment réussi sur quatre tailles, captures clair/sombre ; capture sombre
2048×1320 inspectée par l'agent. Revue humaine `pending`, viewer en anglais.
Artefact : `dist/architecture/game-transformation.architecture.html`.
SHA-256 source : `1555132720f900a729be3e92e2569368adcb76f024a771313b8e96d9dc224d9f`.
SHA-256 HTML : `519a646a3d250492f0d936d1798b42675afc29270ef84b246e2258fbca460278`.
Instructions et hooks inchangés ; aucun fichier supprimé ni dépendance installée.

Historique de cadrage et de vérification :

Dernier cadrage : [interactions programmables](architecture/theme-interactions.md)
et [ADR-0039](decisions/ADR-0039-programmable-theme-interactions.md).
Objets, géométrie et boutons peuvent ouvrir des panneaux ; leurs contrôles
pilotent animations/effets, dont les événements actualisent l'UI. C0–C2 et C5
sont précisés sans nouveau bus ni adoption de moteur. Le schéma runtime inclut
désormais scène et panneaux. Tests I01–I10 prévus, aucun code produit exécuté.
Prochaine preuve : préparer E1 puis éprouver en E2 cette chaîne minimale avec
priorité des icônes natives et budget énergétique par surface.

Vérification de cette extension : `npm run verify` réussi (262 tests réussis,
1 ignoré, 0 échec ; 3 intégrations réussies ; 0 vulnérabilité npm).
Archify showcase : 9/9, aucune erreur ni avertissement ; contrôle automatique
réussi sur quatre tailles en clair/sombre, capture sombre 2048×1320 inspectée
par l'agent. Revue humaine toujours `pending` ; commandes du viewer en anglais.
Artefact : `dist/architecture/runtime-infrastructure.architecture.html`.
SHA-256 source : `ebaf25802dceb677b59ca94e14d9f3508db9116ea4b24177a8858833c983e240`.
SHA-256 HTML : `290b4a431f3ae295598794e1d929f1b136c440febeffd836b7e0ce66f8c332ec`.
Aucun fichier supprimé, aucune dépendance installée ; instructions et hooks
inchangés. Ces contrôles valident la documentation et le socle, pas le produit.

Les comptes rendus ci-dessous concernent les mises à jour précédentes.

Clarification et preuves natives : Godot est hors shortlist active, conservé comme
référence historique seulement. Direction : runtime ciblé, bibliothèques spécialisées
et adaptateurs natifs ; pas de moteur complet imposé. Voir le
[préflight actualisé](research/stack-preflight.md).
Le [diagnostic natif MAC-01](research/os-feasibility.md#diagnostic-natif-effectivement-exécuté)
a terminé avec code 0 : écran 1512×982 points à facteur 2, maximum annoncé 120 Hz,
Metal à mémoire unifiée, préflight écoute positif pour le processus de diagnostic.
rustc/cargo 1.97.1 vérifiés sans installation automatique. Aucun rendu, fenêtre,
hook, capture, changement de permission ou benchmark produit exécuté.
Lecture ciblée de Lively documentée ; B-O08 ajoute le cas du focus refusé par l'OS.
Les contrats et sources Archify ne changent pas : précisions de recherche et de
test seulement, pas de nouvelle frontière architecturale ou dépendance adoptée.

Vérification de cette mise à jour : `npm run verify` réussi ; 262 tests réussis,
1 ignoré, 0 échec, 3 intégrations réussies et 0 vulnérabilité npm. La commande
extraite du bloc documentaire a été réexécutée avec code 0 et mêmes observations.
64 liens locaux vérifiés sur les six documents modifiés, aucun fichier cible absent.
`git diff --check` propre ; aucun fichier supprimé ni changement des hooks.

Travail précédent : [faisabilité OS](research/os-feasibility.md) et
[préflight de stack](research/stack-preflight.md). MAC-01 observé en lecture seule :
M1 Pro, 16 Go, macOS 26.2 ARM64, écran principal 3024×1964 ; SDK 26.5 et outillage
Apple accessibles. Aucun ancrage ni mesure énergie exécuté ; pas de demande de
permission, dépendance installée ou donnée matérielle identifiante conservée.
Les révisions amont sont des repères de recherche, pas une stack verrouillée.
Prochaine action : compléter fréquence/profil/instruments et budgets E1, définir
les cibles de première livraison puis préparer la sonde native macOS.
Contrats et schéma runtime inchangés : cette étude ne modifie aucune frontière
ni dépendance adoptée et ne nécessite pas de nouveau diagramme ou ADR d'adoption.

Vérification du préflight : `npm run verify` réussi (262 tests réussis, 1 ignoré,
0 échec ; 3 intégrations réussies ; 0 vulnérabilité npm). Les 83 liens locaux
des huit documents parcourus existent ; `git diff --check` propre. Les schémas
produit existants sont revalidés par le build, sans nouvelle revue visuelle puisque
leurs sources ne changent pas. AGENTS.md, CLAUDE.md et les hooks sont inchangés.

Vérification de la consolidation précédente (ba72b4f) : `npm run verify` réussi
(263 tests : 262 réussis, 1 ignoré, 0 échec ; 3 tests d'intégration réussis ;
audit npm : 0 vulnérabilité). Aucun test produit ni mesure énergétique exécuté.
AGENTS.md, CLAUDE.md et les hooks restent inchangés ; aucune suppression de fichier.

Archify : runtime showcase validé 9/9, 0 erreur/avertissement ; HTML livré sous
`dist/architecture/runtime-infrastructure.architecture.html`. Contrôle visuel
automatique réussi sur quatre tailles, captures claires/sombres ; capture sombre
2048×1320 inspectée par l'agent. La revue humaine reste `pending` dans le reçu
`dist/architecture/runtime-infrastructure.architecture.visual-check.json`.
Le viewer conserve ses commandes anglaises ; le diagramme produit est en français.
Empreinte source : `cec1c002c6ee742d2d0905a7a79210a95b595083b359f17a3c54bd687c1da16d`.
Empreinte HTML : `9e836e2556eef3816a1592bb842d2b4b8124b53fa0ebc6729d3e9c0b507b341f`.

Dernière consolidation : [ADR-0038](decisions/ADR-0038-neutral-experimental-protocol.md),
[synthèse des audits](research/architecture-audit-synthesis.md) et
[protocole expérimental](04-experimental-protocol.md). Les corrections techniques
sont séparées des hypothèses ; B-R/B-T/B-O/B-F sont prévus, aucun n'est exécuté.
Autonomie wallpaper et sessions conditionnelles précisées dans C2/C3 et le schéma.
La protection des sessions vise les pannes du wallpaper, pas une persistance
universelle. Aucun choix forcé de terminal natif, vidéo ou Wasm. La prochaine
action reste de renseigner machines/instruments/budgets E1 avant le premier PoC.

Review précédente : [ADR-0037](decisions/ADR-0037-replaceable-module-contracts.md) et
[contrats C0–C6](architecture/module-contracts.md). Propriétaires et échanges
documentés sans figer les codecs/API. E2 doit éprouver une scène représentative
et R01–R04, pas seulement un triangle. Contraintes terminal/import examinées dès
E1 par fixtures/doubles, implémentations complètes toujours en E4/E6.

Ordre de réalisation actuel : [feuille de route E1–E6](03-product-roadmap.md),
selon [ADR-0036](decisions/ADR-0036-evidence-first-roadmap.md). E1 à préparer,
aucune étape produit exécutée. Cette feuille de route remplace les anciens ordres
de discussion ci-dessous, qui restent historiques.

Décision de compatibilité : [ADR-0035](decisions/ADR-0035-platform-capabilities-and-energy.md),
énergie prioritaire et [matrice OS par fonctionnalité](architecture/runtime-infrastructure.md#matrice-de-qualification-par-fonctionnalité).
Aucun OS certifié. Rust/wgpu/WGSL pour le wallpaper natif devient la recommandation
à éprouver, terminal Tauri/xterm.js séparé ; aucune dépendance adoptée ou installée.
Prochaine action : choisir les machines/versions de référence et le premier PoC
surface native + mesure énergétique, avant de figer la stack.

Décision de périmètre : [ADR-0034](decisions/ADR-0034-theme-first-and-on-demand-discovery.md).
Nous créons des packages de thèmes pour wallpapers et terminaux custom.
Nos créations et notre logique restent séparées de la bibliothèque locale du jeu.
À la demande, l'IA recherche les dépôts publics utiles, inspecte et prépare une
chaîne isolée, puis conserve l'adaptateur et ses preuves pour réutilisation.
Pas de catalogue exhaustif à remplir, pas de jeu complet à décompiler avant
chaque thème, pas d'IA requise pour l'affichage. ROM et diagnostics privés restent
locaux. La stack et le fournisseur IA sont à discuter ensuite, sans priorité
figée à Rust/Tauri/Godot. Aucun outil découvert n'a été exécuté dans ce dépôt.

Étape antérieure : [infrastructure locale](architecture/runtime-infrastructure.md)
et [cartographie élargie des consoles](research/console-coverage.md), avec
[ADR-0033](decisions/ADR-0033-runtime-boundaries-and-evaluation.md).
Responsabilités séparées sans multiplier les démons ; organisation future des
sources et données documentée sans dossiers vides ni déplacement du blueprint.
Assemblage antérieurement proposé, désormais sans priorité : Rust/Tauri/xterm.js/portable-pty pour le
terminal et contrôle, Godot pour la scène ; intégration OS et énergie non prouvées.
Ce ne sont pas des dépendances adoptées. Aucune console n'est encore certifiée
convertible dans notre produit ; les émulateurs servent de références hors ligne.

Historique : lire aussi [la transformation du jeu](architecture/game-transformation.md)
et [ADR-0030](decisions/ADR-0030-game-transformation.md). L'utilisateur veut
programmer des compositions à partir d'une bibliothèque couvrant le jeu entier,
avec ressources, relations, collisions et comportements compris, tout en
n'exécutant que la sélection nécessaire. Mario Kart reste un exemple.
La composition par code est prioritaire. Une décision antérieure est
[ADR-0031](decisions/ADR-0031-canonical-library-and-capabilities.md) : bibliothèque
canonique préservée, indexation globale et exports progressifs par scène,
comportements ambiants adaptés, clics et réactivité système, capacités explicites,
profils énergétiques soumis à mesure. OoT est candidat prioritaire pour un PoC
avant sélection définitive du pilote. La ROM/version, la scène précise et les
machines de mesure restent à fournir ou choisir ; aucun PoC n'a été exécuté.

Lire [AGENTS.md](../AGENTS.md), la [vision produit](00-project-brief.md), puis
les [questions techniques](01-technology-decisions.md).
Dernier ajout : [ADR-0032](decisions/ADR-0032-local-conversion-and-theme-distribution.md).
Convertisseur local séparé, ROM fournie par l'utilisateur, recettes distribuées
sans assets extraits et aucun envoi de données du jeu côté fournisseur.
La bibliothèque persistante locale est une hypothèse à confirmer pour sa
conservation/purge ; ne pas confondre cette question avec le refus de collecte.
Les candidats terminal/wallpaper et la liste d'émulateurs hors ligne sont
archivés dans les questions techniques, sans adoption ni preuve d'exécution.
Le projet reste volontairement au statut `template`. Ne pas lancer
`npm run initialize` ni développer le produit avant la discussion technique.

## Ce que l'utilisateur a confirmé

- Un bureau interactif et un terminal personnalisé, avec une fusion visuelle
  mais aussi les modes terminal seul et bureau seul.
- Des sessions de shells et d'agents représentées par des joueurs sélectionnables.
- Mario Kart et la liste des joueurs en haut à droite comme exemple, pas comme
  jeu pilote ou disposition définitivement choisis.
- Des personnages interchangeables et des données de jeu isolées pour recomposer
  les thèmes ; changer d'apparence doit préserver le travail.
- Linux, macOS et Windows comme cible, avec couverture exacte encore à définir.
- Créer le moins possible nous-mêmes : examiner l'existant avant la stack.

## État du socle et provenance

Le dossier était vide. Le template a été cloné depuis
[zenonlab/ctxroute-blueprint](https://github.com/zenonlab/ctxroute-blueprint),
révision `dbfb2e054b311c642ca75cc2ec35d605a42f1c1d`.
Son historique et ses notices de licence sont conservés. Aucun dépôt distant
produit n'a été créé et aucun push n'est prévu pour cette étape.
Le remote `origin` désigne encore le blueprint amont : ne pas y pousser le produit.

Environnement observé : macOS, Node 24.18.0, npm 11.16.0, Python système 3.12.0,
uv 0.11.2, Git 2.52.0. L'environnement CRG utilise Python 3.12.10.

`npm run setup` a terminé avec succès avant les modifications documentaires :
installation verrouillée, CTXRoute 2.0.0, Archify 2.16.0, Code Review Graph 2.3.8,
construction du graphe local, activation de `.githooks` et validation du template.
La couverture globale rapportée était 91,09 % lignes, 75,44 % branches et
88,55 % fonctions. Ces mesures concernent le template.

Les manifests MCP du projet déclarent `ctxroute-orchestrator` et
`code-review-graph`. Leur présence ne prouve pas leur chargement dans le client.
À la nouvelle session ouverte depuis ce dossier, vérifier `/mcp` et approuver
les six définitions locales dans `/hooks` si Codex le demande, conformément
au [guide amont conservé](../README.md). Aucune configuration globale modifiée.

## Vérification finale

Étape contrats : source runtime C1–C5 et document C0–C6 alignés ; huit tests de
remplacement R01–R08 spécifiés, aucun exécuté en produit. Schéma architecture
Archify livré, 9 contrôles showcase réussis, 0 erreur/avertissement. Contenance
réussie aux quatre tailles desktop ; capture sombre 2048×1320 inspectée par l'agent.
Reçu automatique `visualReview: pending`, interface fixe en anglais.
Source SHA-256 `d3b3a6a10781bd3a016ec75f51c26bec3280ad7dd9713f21b13cd1e7d024d6e2`
(1783 octets), HTML SHA-256
`eeddaba389fd7bca1c00d502fd586d1444c212baa083a8ec1586b1313134428c`
(706087 octets), artefact `dist/architecture/runtime-infrastructure.architecture.html`.
Audit du diff : AGENTS.md, CLAUDE.md, .codex/hooks.json, hooks et configuration
produit inchangés ; uniquement documentation, registre documentaire et schéma.
`npm run verify` réussi : 263 tests (262 réussis, 1 ignoré, 0 échec), 3 tests
d'intégration réussis et audit npm sans vulnérabilité. Ces contrôles valident
le socle et les documents, pas la remplaçabilité effective des futurs modules.

Étape feuille de route : workflow E1–E6 validé avec Archify, 9 contrôles showcase
réussis, 0 erreur et 0 avertissement. Contenance vérifiée aux quatre tailles
desktop ; capture sombre 2048×1320 inspectée par l'agent. Reçu automatique
`visualReview: pending` ; interface fixe en anglais, contenu en français.
Source SHA-256 `9a4669b4fd030b89e23ff46584edc5baf8ededaa0197042905d103abf6c69f0c`
(1893 octets), HTML SHA-256
`aa2e971f621a592982160918710d2a7adc9168e0600ce6084b00461fc25cd949`
(706958 octets), artefact `dist/architecture/product-roadmap.workflow.html`.

Une première vérification a détecté le refus de workflow v2 par validate-docs.
Correction limitée à l'enveloppe de version, couverte par 14 tests ciblés réussis.
Audit blueprint : conforme, aucun nouveau module/dépendance runtime ; allowlist
et fermeture transitive vérifiées par `npm run blueprint:review`. Progress absent
du câblage et Stop fail-open selon ce contrôle. Requêtes, autorité des workers,
schémas de rapports et modes de coordination inchangés dans le diff.
AGENTS.md, CLAUDE.md et .codex/hooks.json inchangés. Seul le validateur documentaire
est modifié parmi les hooks ; rollback documenté dans ADR-0036. Aucun code produit.
Vérification complète après correction : `npm run verify` réussi, 263 tests
(262 réussis, 1 ignoré, 0 échec), 3 tests d'intégration réussis, audit npm sans
vulnérabilité et génération des quatre schémas produit réussie. Ce résultat ne
valide ni un prototype ni la consommation sur un OS cible.

Étape matrice OS : schéma runtime livré avec Archify, 9 contrôles showcase
réussis, aucune erreur ni avertissement. Contrôle de débordement réussi aux
quatre tailles desktop ; capture sombre 2048×1320 inspectée par l'agent.
Le reçu automatique conserve `visualReview: pending` (pas de validation humaine).
Interface fixe du visualiseur en anglais, contenu produit en français.
Reçu de livraison : source SHA-256
`f19f2da4b7f4a1fb50989740b561c099bf14702be4380531346e98464a92a0cb`
(1795 octets), HTML SHA-256
`df10dd3c62c09b1a41f69a7778c1333593074aaee8738d474fef611057eee663`
(706140 octets). Artefact local :
`dist/architecture/runtime-infrastructure.architecture.html`.
`npm run verify` réussi : 262 tests du socle (261 réussis, 1 ignoré, 0 échec),
3 tests d'intégration réussis et audit npm sans vulnérabilité. Aucun test desktop
produit exécuté. AGENTS.md, CLAUDE.md, configuration et hooks inchangés.

Recadrage thèmes/IA : schéma de préparation actualisé, livré avec Archify,
`npm run verify` réussi : 261 tests réussis, un ignoré, aucun échec ; trois
tests d'intégration réussis et audit npm sans vulnérabilité signalée.
Ces contrôles vérifient le dépôt ; aucun runtime ni assistant IA produit testé.
Le statut reste `template`, sans dépendance produit ni modification des hooks.
Validation du schéma :
9/9 contrôles showcase réussis, zéro erreur/avertissement. Contenance validée
aux quatre tailles desktop ; capture sombre 2048×1320 inspectée par l'agent.
Revue humaine du reçu `pending`, interface fixe du visualiseur en anglais.
Artefact : `dist/architecture/game-transformation.architecture.html`.
SHA-256 source : `7dedaf23ac97af4b8c843b6da0d40fc7513342ab1518d02857532786f7677636`.
SHA-256 HTML : `5857b34a999c8dd5af767bfa9c99cd3b03c9be92ea95316b016e9690bc61592b`.
Les empreintes suivantes décrivent les versions antérieures, pas cet artefact.

Étude infrastructure/consoles : troisième schéma produit livré et validé par
Archify (architecture, 9/9 contrôles showcase, zéro erreur/avertissement).
`npm run verify` réussi : 261 tests réussis, un ignoré, aucun échec ; trois
tests d'intégration réussis, audit npm sans vulnérabilité signalée. Le registre
déclare les trois schémas produit ; le statut demeure `template` et les hooks
sont inchangés. Ces résultats vérifient le dépôt, pas le produit envisagé.
Contenance vérifiée à 1440×900, 1600×1000, 1920×1080 et 2048×1320 ; capture
sombre 2048×1320 inspectée par l'agent, revue humaine du reçu `pending`.
Artefact : `dist/architecture/runtime-infrastructure.architecture.html`.
SHA-256 source : `81ec3ca438081182efc3c5e9690a7c6ae47b587ba6fee1fa330c4dd417c54129`.
SHA-256 HTML : `16682c09692b10393c6e6eb525511e033724d91e77d1c886511255b6b8b78c6f`.

Mise à jour distribution locale : `npm run verify` terminé avec succès
pour cette mise à jour documentaire (261 tests réussis, un ignoré, aucun échec ;
trois tests d'intégration réussis ; audit npm sans vulnérabilité signalée).
Le projet conserve le statut `template` ; aucun code produit ni hook modifié.
Schéma `game-transformation` livré avec Archify, neuf contrôles showcase
réussis, zéro erreur et zéro avertissement.
Le contrôle de débordement réussit aux quatre tailles desktop ; capture sombre
2048×1320 inspectée par l'agent. La revue humaine du reçu reste `pending`.
Libellés français, interface fixe du visualiseur en anglais (repli Archify).
Artefact : `dist/architecture/game-transformation.architecture.html`.
SHA-256 source : `ad26e413b6b44a6915e151086814213f5b400d6907c507b5177085987b23f8f6`.
SHA-256 HTML : `c8f4ad274b7a4aebeece6e3807e7f8581cca13d94933161d4ed9f385c48b955d`.

Les preuves ci-dessous concernent la validation antérieure du socle et de la
vue produit ; elles ne sont pas des tests du futur runtime.

Le second passage de `npm run verify` a terminé avec succès : validation,
tests du template, smoke CRG, intégration MCP, audit npm et génération HTML.
La suite rapporte 262 tests, 261 réussis, aucun échec ; couverture globale
91,10 % lignes, 75,55 % branches et 88,88 % fonctions. L'intégration rapporte
trois tests réussis. L'audit npm ne signale aucune vulnérabilité.
La configuration conserve bien `status: template` après ces contrôles.

Le schéma conceptuel possède une validation showcase Archify à neuf contrôles,
sans erreur ni avertissement de composition. Sa livraison HTML a réussi.
Le contrôle visuel automatique a réussi à 1440×900, 1600×1000, 1920×1080 et
2048×1320, sans débordement. Les captures claire à 1440×900 et sombre à
2048×1320 ont également été inspectées par l'agent. Le reçu automatique conserve
`visualReview: pending` pour une éventuelle revue humaine.

Artefact : `dist/architecture/product-vision.architecture.html`.
Empreinte SHA-256 source :
`922834c6c73b156e66edb8bc7070f79563845b1ef371c41eae6edc435c072b5e`.
Empreinte SHA-256 HTML :
`c5e6d3fb1285fdb59c76827c60cc66cc03c4783e9c73d3d7088abce0877a81a0`.

Le premier passage de `npm run verify` après rédaction a révélé que le test
d'initialisation pouvait interpréter les décisions rédigées comme complètes et
modifier le statut local. Le statut a été rétabli à `template`, et les champs
de décisions encore ouvertes utilisent désormais les marqueurs entre crochets
reconnus par le validateur amont. Conserver ces marqueurs jusqu'aux décisions
techniques évite une initialisation prématurée ; aucun hook n'a été modifié.

## Ce qui n'est pas réalisé

Aucun terminal, moteur graphique, extracteur, ROM importée ou intégration OS.
Aucun benchmark produit et aucune preuve d'exécution sur Linux ou Windows.
Aucune API ou format `.scene` adopté. Aucune stack produit sélectionnée.
La [recherche archivée](research/initial-research.md) est une synthèse explicitement
non verbatim du texte initial ; ses chiffres et références restent à vérifier.

## Prochaine conversation

Instruction de reprise actuelle : préparer E1 de docs/03-product-roadmap.md.
Identifier matériel/OS, budgets et décisions initiales ; première preuve E2 =
wallpaper synthétique sans ROM ni IA, avant terminal custom. Satisfaire les règles
d'initialisation avant code produit. Les prompts suivants sont historiques et
ne doivent pas rétablir l'ancien ordre ou rendre OoT obligatoire.

Priorité actuelle : comparer les solutions existantes pour créer, installer et
activer un package de thème wallpaper/terminal, puis choisir langages, composants
et preuves minimales. La préparation IA à la demande est une capacité séparée,
pas un service à maintenir dans la boucle d'affichage. Les propositions de banc
d'essai ci-dessous restent des possibilités et non un ordre déjà adopté.

Prochaine étape demandée : travailler sur l'architecture et l'infrastructure,
en comparant l'existant avec les frontières maintenant documentées. La discussion
peut commencer sans ROM ; ne pas adopter une stack à partir des seuls exemples.
L'étude documentaire est désormais disponible. La prochaine preuve proposée
est terminal + surface synthétique : choisir l'environnement hôte et le matériel,
puis tester l'ancrage et la consommation avant de verrouiller les composants.
La preuve d'ingestion à préparer reste l'extraction OoT décrite dans
[la transformation du jeu](architecture/game-transformation.md). Aucune ROM
`.z64`, `.n64`, `.v64` ni image `.iso`/`.gcm` n'a été trouvée dans le dossier
du projet lors de cette mise à jour. Identifier l'entrée et sa version avant
d'exécuter l'extraction. Comparer ensuite terminal, bureau et intégration à
partir des capacités démontrées ; les formats et la stack restent ouverts.

Prompt de reprise possible :

> Lis docs/session-handoff.md et le brief produit. Nous allons choisir les
> technologies et l'infrastructure en réutilisant au maximum l'existant.
> Compare d'abord les bases possibles pour un terminal et un bureau ludiques
> modulaires sur Linux, macOS et Windows. Ne considère pas la stack de la
> recherche initiale comme déjà décidée.

Précision au prompt :

> Commence par ADR-0034. Le produit est le package de thème, pas un catalogue de
> consoles. L'IA peut découvrir et préparer les outils à la demande, avec validation
> locale et dépendances séparées. Compare la stack sans privilégier automatiquement
> Rust/Tauri/Godot ; ne lance pas de conversion ni d'installation pour cette discussion.

Prompt complémentaire pour poursuivre la réflexion :

> Lis docs/architecture/game-transformation.md et ADR-0031. Prépare le PoC OoT
> avec les outils existants : identifier la ROM/version disponible et une scène,
> vérifier géométrie, matériaux, acteur animé, collision, audio et placements
> traçables. Conserver les données canoniques et qualifier les capacités manquantes.
> Ne fixe pas la stack avant ces preuves. La composition par code et le diorama
> ambiant économe sont déjà décidés ; la couverture globale progresse par scène.
