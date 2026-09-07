# Protocole expérimental produit

État : protocole préparé le 7 septembre 2026 ; aucun essai produit exécuté.
Complète la [stratégie qualité](02-quality-strategy.md), les tests P01–P28 et
[R01–R08](architecture/module-contracts.md), sans changer l'ordre E1–E6.
La [synthèse des audits](research/architecture-audit-synthesis.md) distingue les
faits sourcés, les hypothèses et les propositions non retenues.

## Préparation E1 et ordre d'exécution

E1 doit enregistrer les machines effectivement disponibles, versions OS/compositeur,
GPU/pilotes, écrans, instruments et périmètre fonctionnel de référence. Un premier
[préflight MAC-01](research/os-feasibility.md#premier-banc-observé--mac-01) relève
matériel et outillage en lecture seule ; fréquence écran, profil de mesure et
qualification des instruments restent à compléter. Ce relevé ne clôt pas E1.
Définir avant les mesures les budgets par scénario (énergie, mémoire, latence),
les marges d'incertitude admissibles et la capacité de maintenance de l'équipe.
Ne pas transformer les chiffres des audits en seuils de production.

1. Examiner les capacités et coûts d'intégration des candidats sur documentation
   et exemples existants ; retenir au plus deux finalistes crédibles par question.
2. En E2, éprouver d'abord l'ancrage sur la première machine cible, puis l'énergie
   et une scène représentative, avec contrats et relations synthétiques R01–R04.
3. En E4, comparer les implémentations terminal suffisamment complètes ; E1/E2
   n'exigent que l'étude des contraintes et des doubles bornés de sessions.
4. En E5, étendre la qualification OS. En E6 seulement, éprouver la conversion
   optionnelle, sans faire d'une ROM un prérequis aux mesures du runtime.

Un exemple amont sert à évaluer la faisabilité, pas à certifier notre intégration.
Ne pas construire quatre moteurs et deux terminaux complets pour choisir la stack.
Les changements de périmètre fonctionnel importants appellent un arbitrage produit,
pas une substitution silencieuse dans le banc.

## Règles métrologiques communes

- Mesurer énergie E en joules et puissance moyenne P = E/T en watts. Comparer
  ΔE et ΔP au bureau natif avec même durée et activité de fond ; préciser le domaine
  matériel mesuré. Pour une charge à terminaison, publier également énergie jusqu'à
  complétion, durée et débit : un traitement plus lent ne doit pas sembler meilleur
  uniquement grâce à une puissance instantanée plus basse.
- Stabiliser thermiquement, prévoir un warmup, puis au moins cinq passes par cas.
  Alterner l'ordre des candidats et intercaler les références pour limiter la dérive.
  Publier les valeurs brutes, moyenne, médiane, écart-type et événements perturbateurs.
  Augmenter les répétitions si nécessaire ; une différence noyée dans le bruit est
  non concluante. Ne pas supprimer des valeurs défavorables sans règle documentée.
- Fixer luminosité, résolution, fréquence écran, nombre d'écrans, profil d'alimentation,
  versions, contenu, réseau et charge de fond. Séparer batterie et secteur. Conserver
  les transitions normales d'économie d'énergie ; le verrouillage des fréquences
  matérielles est réservé à un diagnostic séparé, pas au banc principal d'autonomie.
- Comptabiliser les processus auxiliaires, y compris WebView/GPU helpers hors arbre
  direct lorsque attribuables. Ne pas compter deux fois les threads et leur processus.
  La mesure matérielle globale n'est pas une attribution exacte de joules par processus.
- Distinguer RSS agrégé, mémoire privée, PSS ou footprint selon l'OS. La somme des RSS
  peut compter plusieurs fois les pages partagées ; publier la définition utilisée
  au lieu de comparer sans précaution des métriques différentes entre OS.
- RAPL mesure des domaines matériels ; ne pas additionner un domaine parent et ses
  sous-domaines. Qualifier powermetrics, compteurs Windows et outils pilotes sur la
  machine réelle : mesure, estimation attribuée et delta système ne sont pas synonymes.
  Mesurer le coût de l'instrumentation ; une interrogation du GPU peut le réveiller.
- Séparer saisie→traitement, saisie→soumission graphique et saisie→pixel visible.
  Seule cette dernière est une latence input-to-photon ; prévoir une instrumentation
  optique pour l'affirmer. Publier le point final réellement observé.

Sources méthodologiques : [Linux powercap/RAPL](https://www.kernel.org/doc/html/latest/power/powercap/powercap.html),
[Linux proc, RSS et PSS](https://www.kernel.org/doc/html/latest/filesystems/proc.html).
Une mesure à 0 FPS ou un compteur arrondi à 0 % ne prouve pas zéro watt.
NVML ou un compteur d'utilisation seul ne certifie pas D3cold ; préciser la preuve
d'état d'alimentation disponible et ses limites par matériel.

## B-R — Socle de rendu et énergie

Question : quelle brique réutilisée couvre nos thèmes, à quel coût d'intégration
et d'énergie ? Comparer le candidat wgpu à une solution existante adaptée au besoin,
sans importer ses types dans C0–C3. Ne pas confondre wrapper GPU et moteur de scène.

| Cas | Charge reproductible | Preuve attendue |
| --- | --- | --- |
| B-R01 | Image statique 10 minutes après premier affichage | Présentations après stabilisation, réveils, mémoire, ΔE/ΔP ; référence wallpaper natif |
| B-R02 | Trois jauges et un portrait mis à jour à 1 Hz, valeurs déterministes | Invalidation uniquement nécessaire, coût des mises à jour et des uploads |
| B-R03 | Même décor cyclique de 60 secondes, trajectoire fixe | Comparaison rendu temps réel/vidéo si visuellement comparables ; codec, résolution, fréquence et chemin hwdec effectif consignés |
| B-R04 | Objet ouvrant un panneau, bouton pilotant animation/effet, résultat actualisant l'UI ; déplacer l'objet et modifier la caméra | Parcours I01 sans terminal ; préservation de la recomposition ; une vidéo fixe ne réussit pas ce cas par équivalence visuelle |
| B-R05 | Masquage, verrouillage, veille/reprise, un seul moniteur masqué et panneau distinct restant visible | Budget par surface, suspension des soumissions/décodage concernés, reprise correcte, politique audio explicite ; voir I08/I10 |
| B-R06 | Surface inactive sur machine hybride | Adaptateur choisi, résidence GPU, preuve d'état d'alimentation et effet éventuel des instruments |

Documenter draw calls, uploads, pixels/overdraw, mémoire, coût CPU et nombre de
présentations, sans supposer que leur somme prédit exactement les watts. Un thème
statique ne doit pas initialiser un système de simulation 3D inutile. Un thème animé
demande une échéance de réveil explicite ; « événementiel » ne signifie pas figer
arbitrairement toutes les animations à 0 FPS.

Relever le code spécifique et les fonctionnalités restant à écrire, les dépendances
et l'entretien estimé. Les lignes de code ne sont qu'un indicateur contextualisé,
pas une conversion automatique en mois. Si les capacités diffèrent, présenter deux
résultats distincts plutôt que déclarer le candidat incomplet gagnant.

## B-T — Terminal comparable et borné

Question : réutilisation Tauri/xterm.js contre intégration native complète assez
représentative, sans présupposer l'avantage énergétique ni la conformité textuelle.
Relever version, moteur de rendu textuel, options, polices et fonctionnalités
manquantes. Une simple grille native ne remplace pas une interface utilisable.

Paramètres communs : dimensions de grille identiques, scrollback de 10 000 lignes
logiques avec règle de repliement explicitée, polices identiques si disponibles,
PTY et corpus déterministes. Les deux chemins disposent de backpressure, de tampons
bornés et d'une politique explicite de regroupement. Les 4–8 ms proposés dans les
audits sont un réglage à comparer, pas une constante obligatoire. Consigner les
addons xterm réellement activés et leurs chemins de repli.

| Cas | Charge | Observation |
| --- | --- | --- |
| B-T01 | Invite inactive 10 minutes, curseur fixe puis clignotant | Coût de repos et coût propre du clignotement |
| B-T02 | 5 caractères/seconde puis navigation TUI déterministe | Latence au point mesuré, saisie/focus, régularité du rendu |
| B-T03 | 500 000 lignes ANSI colorées déterministes | Énergie jusqu'à complétion, débit, mémoire maximale, absence de perte et de blocage durable |
| B-T04 | Même sortie avec fenêtre minimisée/masquée | PTY correctement consommé sans dessin inutile ; état final identique |
| B-T05 | IME CJK, caractères combinés, emoji, texte bidirectionnel | Résultats constatés par fonctionnalité, pas une conformité Unicode présumée |
| B-T06 | Sélection, presse-papiers, liens, redimensionnement, lecteur d'écran | Accessibilité et intégration réellement utilisables sur chaque OS testé |

Ne pas utiliser un flux base64 aléatoire comme preuve de traitement ANSI coloré.
Publier empreinte du corpus, octets attendus/reçus et état final de grille. Une
limite de mémoire atteinte doit réguler le producteur, pas supprimer silencieusement
la sortie. Évaluer séparément les séquences terminal pouvant demander des actions
sensibles ; le contenu PTY n'obtient pas de permission système via le thème.

Une différence de 10 %, 250 Mo ou 100 ms ne sélectionne pas automatiquement une
technologie. Comparer aux budgets préalablement définis, à la dispersion et aux
fonctionnalités livrées. Optimisation, nouvelle mesure et arbitrage documenté
précèdent une adoption ou un abandon.

## B-O — Ancrage, priorité native et visibilité

Question : quelles capacités sont fiables sur une combinaison précise OS, shell,
version, moniteurs et permissions ? Commencer avec une ancre synthétique ; placer
une icône native exactement dessus, partiellement puis complètement.

| Cas | Action | Critère fonctionnel |
| --- | --- | --- |
| B-O01 | Clic simple/double/droit sur l'icône superposée | Action native seule ; zéro intention wallpaper parasite |
| B-O02 | Sélection rectangulaire depuis zone neutre, déplacement d'icône et glisser-déposer | Gestes natifs préservés, aucun clic synthétique ajouté |
| B-O03 | Clic sur l'ancre dégagée | Une intention autorisée, pas de double-clic requis pour focus, pas de capture clavier implicite |
| B-O04 | Appui en zone neutre puis relâchement sur ancre, et inversement | Aucun détournement d'un geste commencé ailleurs ; politique capture/annulation explicitée |
| B-O05 | Fenêtre opaque/translucide, plein écran, plusieurs moniteurs | Visibilité connue/inconnue explicitement rapportée ; pas d'assimilation automatique plein écran=occlusion totale |
| B-O06 | DPI mixte, hotplug, Spaces/bureaux virtuels, redémarrage du shell | Coordonnées et cycle de surface corrects, réattachement ou repli explicite |
| B-O07 | Permissions refusées, API absente, terminal absent | Mode dégradé annoncé, aucune élévation ou relance cachée |
| B-O08 | Sélection de session puis demande de premier plan acceptée/refusée par l'OS | Distinguer session sélectionnée, requête transmise et activation visible ; aucun faux succès ni contournement de focus |

Pour chaque geste répéter et consigner le nombre d'essais et d'échecs. Zéro échec
observé n'est pas une garantie universelle. Sur un bureau sans gestionnaire d'icônes,
B-O01 est non applicable, pas validé pour Explorer/Finder/Plasma.

Windows : WorkerW reste une intégration non documentée à éprouver, sans présumer
que styles ou régions garantissent le routage interprocessus. macOS : tester la
fenêtre réellement derrière le Finder, pas uniquement une vue en fenêtre normale.
Wayland : région vide réelle pour le mode passif, régions ciblées pour l'actif ;
tester également le recouvrement par les surfaces du bureau. Vérifier séparément
les moyens disponibles de suivi du pointeur et de visibilité.

GNOME : relever les globals annoncés ; absence de layer-shell → repli explicite.
Une extension Shell serait un livrable distinct à maintenir et qualifier, pas un
contournement implicitement autorisé. X11 reste une cible à tester dans son propre
environnement, sans extrapoler les résultats Wayland.

Si la priorité native échoue, désactiver la capacité d'interaction directe sur cette
configuration. Une surcouche flottante ou un mode modal est une option produit à
décider, pas un remplacement automatique. Si l'occlusion est inconnue, appliquer
la politique conservatrice définie en E1 (plafond et pause manuelle), sans annoncer
une suspension totale détectée.

## B-F — Autonomie et domaines de panne

- Wallpaper seul : animation, son et intention locale autorisée fonctionnent sans
  terminal ni PTY. Une action refusée produit un diagnostic ; le thème ne lance
  jamais arbitrairement une commande.
- Terminal seul : fonctionne sans moteur de wallpaper. Les flux PTY restent dans
  le domaine terminal ; seuls états sémantiques et intentions traversent la liaison.
- Arrêt/crash/gel du wallpaper : shells et tâches déjà lancés continuent ; files IPC
  bornées, déconnexion tolérée et absence de blocage du terminal. Tester réellement
  les liens de supervision et de terminaison des processus.
- Terminal absent/déconnecté : associations de sessions indisponibles ou inactives,
  reste du wallpaper opérationnel ; aucun lancement automatique du terminal.
- Reconnexion : identités/révisions vérifiées, intentions périmées rejetées, pas de
  répétition aveugle d'une action non idempotente. Demande de focus soumise aux
  restrictions OS et résultat explicite si non réalisable.

Ces essais ne garantissent pas la survie à l'arrêt du propriétaire PTY, à un OOM
global, à une déconnexion utilisateur ou au redémarrage. Un superviseur détaché
serait un besoin séparé ; il ne fait pas survivre un processus à un reboot.

## Preuves, décisions et critères de sortie

Chaque compte rendu doit contenir : identifiant B-*, date, opérateur, commits des
candidats, machine/OS/pilotes, configuration, capacités attendues, corpus et hash,
instruments/domaines/unités, référence sans produit, passes brutes, résultats
agrégés, erreurs, limites, coût d'intégration et décision motivée.

Statuts autorisés : prévu, exécuté-réussi, exécuté-échoué, non applicable ou non
concluant. Stocker les futures preuves synthétiques dans un dossier d'expérience
versionné ; garder captures et journaux contenant des données privées hors des
packages et hors de toute transmission IA distante. Aucun dossier de résultats
factice n'est créé avant exécution.

Un ADR d'adoption référence les preuves, le périmètre couvert, les budgets retenus,
les limites et le coût de remplacement. Les tests du blueprint et la validation
des schémas documentaires ne valent jamais réussite de B-R/B-T/B-O/B-F.
À ce jour tous ces essais sont prévus ; la prochaine action est de renseigner
le banc réel et les budgets E1 avant d'écrire le premier prototype.
