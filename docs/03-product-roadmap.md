# Feuille de route produit — progression par preuves

État au 7 septembre 2026 : plan documenté, **E1 à préparer ; E2–E6 non démarrées**.
Aucun prototype produit, benchmark ou support OS certifié. Ce document est la
référence unique pour l'ordre d'exécution ; les anciens ordres de discussion et
la roadmap de recherche sont historiques, sans engagement de calendrier.
Voir [ADR-0036](decisions/ADR-0036-evidence-first-roadmap.md) et le
[workflow produit](architecture/src/product-roadmap.workflow.json).
La review de modularité est précisée par [ADR-0037](decisions/ADR-0037-replaceable-module-contracts.md)
et les [contrats C0–C6](architecture/module-contracts.md) : préserver les données
et tester le remplacement des modules, sans promettre une migration gratuite.

## Règles de progression

Avancement documentaire E1 : [MAC-01 et faisabilité OS](research/os-feasibility.md)
relevés ; [préflight de stack](research/stack-preflight.md) préparé. Budgets,
instruments de mesure et autres bancs restent à qualifier. Aucun prototype exécuté.

Le [protocole expérimental E1](04-experimental-protocol.md) précise les mesures
et les preuves à produire sans modifier cet ordre. Étude courte des candidats,
puis au plus deux finalistes par question ; pas de construction simultanée de
plusieurs moteurs complets. B-O/B-R commencent en E2, B-T complet en E4,
qualification élargie en E5 et extraction optionnelle en E6.

Énergie du wallpaper d'abord, personnalisation ensuite. Réutiliser l'existant,
mesurer avant de généraliser, ne jamais rendre IA ou conversion obligatoires
pour utiliser un thème préparé. Le premier thème est original et synthétique,
sans ROM ni contenu tiers privé. Les trois modes restent la cible du produit.

Chaque étape requiert un livrable, des tests et un verdict daté : réussi, à
reprendre ou non exécuté. Un échec entraîne une correction/recomparaison au même
stade, pas l'ajout des couches suivantes pour le masquer. Réduire un périmètre
produit ou accepter un budget dépassé exige une décision explicite consignée.
Les vérifications ordinaires ne créent pas de pauses conversationnelles.

## Étapes et critères de sortie

| Étape | Entrée / dépendance | Travail et livrable borné | Critère de sortie |
| --- | --- | --- | --- |
| E1 — Banc et décisions initiales | Cadrage et matrice OS existants | Identifier premier OS/build, CPU/GPU/pilote, écran, accès aux autres machines ; thème synthétique statique et animé ; protocole, budgets et candidats versionnés. Renseigner les décisions initiales obligatoires du brief. | Fiche de banc reproductible, seuils et conditions de mesure fixés avant comparaison, licences examinées, stack expérimentale et limites de sécurité documentées. Aucun code produit avant la clôture des prérequis d'initialisation. |
| E2 — Wallpaper natif et énergie | E1 et initialisation vérifiée | Petite scène originale avec image 2D, objet 3D animé, transparence, clic et variante visuelle ; surface en fenêtre puis sous le bureau, pause/reprise et recréation. Aucun terminal custom, ROM, IA, physique ou audio nécessaire. | Ancrage, focus/icônes et états statique/animé/masqué testés ; budget tenu ; R01–R04 réussis, capacités absentes signalées. Preuve native minimale sur les environnements de la première livraison avant adoption durable du moteur ; pas d'adoption sur un triangle seul. |
| E3 — Package de thème et sécurité | E2 réussi | Contrat versionné, création par code, installation/activation, références et cache séparés ; actions typées et permissions. Deux thèmes originaux distincts, dont un 2D, sans exceptions par jeu dans le cœur. | Changement de thème, référence manquante et import malveillant testés ; aucune commande implicite, aucun parcours de chemin hors périmètre ; export sans données privées ; budget E2 recontrôlé. |
| E4 — Terminal et sessions | E3 réussi | Réutiliser terminal/PTY, ajouter portraits et associations ; définir fermeture, reprise et paramètres sauvegardés. Vérifier terminal seul, wallpaper seul et ensemble. | Deux sessions stables lors d'un changement/arrêt du décor ; TUI, Unicode/IME, resize et backpressure corrects ; actions explicitement autorisées ; surcoût terminal et IPC mesuré séparément. |
| E5 — Qualification et distribution | E4 réussi | Installation, désinstallation, versions/migrations, politique de mise à jour et reprise après échec ; licences et diagnostics locaux. Rejouer le banc complet par configuration OS annoncée. | Parcours d'installation et trois modes réussis, limites publiées, régressions énergie/sécurité absentes sur le périmètre retenu. Une plateforme non testée reste non testée. Premier thème original livrable sans convertisseur. |
| E6 — Ingestion assistée optionnelle | E5 réussi et demande de thème dépendant d'un jeu | Réutiliser un lecteur public identifié, extraction locale séparée et adaptateur reproductible ; prouver d'abord une chaîne déterministe, puis ajouter la découverte IA bornée. | Pour une entrée/version précise : ressources et relations nécessaires vérifiées, capacités qualifiées, isolation testée, aucun transfert privé ; réactivation sans IA ni émulateur ; partage du thème sans contenu extrait. |

E5 termine le premier parcours de livraison wallpaper + terminal ; E6 est une
extension indépendante de l'affichage, pas une condition pour publier des thèmes
originaux. Une preuve isolée réussie à E2 n'est pas encore ce produit complet.
L'étude documentaire d'un lecteur reste possible en amont ; son implémentation
et l'automatisation IA ne prennent pas la priorité sur les preuves énergétiques.
E1 examine néanmoins les contraintes des futurs terminal et import sur les
contrats communs. E2 utilise doubles et relations synthétiques scène/minimap/portrait
pour les éprouver avant leur stabilisation en E3. Cela n'avance ni le terminal
complet ni l'ingestion IA ; le package public reste à spécifier après le prototype.

## Décisions à fermer au bon moment

Précision [ADR-0039](decisions/ADR-0039-programmable-theme-interactions.md) : E2
inclut une chaîne minimale objet → panneau → bouton → animation et effet → UI,
sans terminal ni bibliothèque complète de widgets. E3 formalise les liaisons,
quotas et annulations ; E4–E5 qualifient saisie, accessibilité et sessions.
Les [tests I01–I10](architecture/theme-interactions.md#tranche-de-validation-et-limites)
complètent les preuves existantes sans changer l'ordre E1–E6.

| Décision encore ouverte | Échéance | Règle de choix |
| --- | --- | --- |
| Machines, versions OS et première cible | E1 | Choisir selon accès réel au matériel ; ne pas inventer des machines disponibles ni promettre tous les OS. |
| Budgets énergie, mémoire, réveils et latence | E1 pour seuils initiaux ; E2 pour verdict | Fixer unités, durée, répétitions et variabilité avant résultats ; les pourcentages historiques ne sont pas des garanties. |
| Langage, rendu, dépendances et tests initiaux | E1 provisoire, E2 adoption du rendu | Rust/wgpu/WGSL est le candidat prioritaire à éprouver ; justifier les écarts ou un moteur existant par coût, fonctionnalités et mesures. Pas deux moteurs complets. |
| Format du thème et API d'actions | E3, avant import externe | Version, références stables, migration, refus des capacités inconnues, limites de taille et validation. glTF est une piste d'asset, pas tout le contrat de thème. |
| Code de personnalisation et isolation | E1 pour le prototype ; E3 avant scripts tiers | Recette par code ne signifie pas script arbitraire privilégié. Choisir compilation hors ligne et/ou runtime borné ; Lua reste une option, pas une dépendance adoptée. |
| Terminal, PTY et persistance des sessions | E4 | Tauri/TypeScript/xterm.js/portable-pty reste candidat ; éprouver les alternatives réutilisables. Distinguer arrêt du décor, de l'application et redémarrage OS. |
| Conservation, purge, export et cache | E3 pour thèmes ; E6 pour données de jeu | Définir ce qui reste local et qui déclenche sa suppression ; aucun effacement implicite de la bibliothèque privée. |
| Audio, animations et navigation | E3 si utilisés, sinon extension explicite | Politique pause/muet/batterie, boucles vérifiées, capacités nécessaires ; ni navigation fictive ni animation fluide annoncée à 1 FPS. |
| Paquets, signature, mises à jour et diagnostic | E5 avant distribution | Aucun cloud requis ; choisir mécanismes réutilisés, consentement, retour à une version fonctionnelle et données collectées par défaut. |
| Lecteur, sandbox et assistance IA | E6 avant traitement privé | Identifier outils/révisions/licences, quotas, réseau et fichiers autorisés, diagnostics locaux ; l'absence d'outil est un résultat valide. |

Les décisions initiales de langage, runtime, frontend, backend, stockage, tests,
déploiement, observabilité, sécurité et performance doivent toutes figurer dans
le brief avant code, conformément à AGENTS.md. E1 peut sélectionner un périmètre
expérimental minimal, sans prétendre adopter les extensions futures : elles
restent hors de ce périmètre et requièrent leur ADR avant introduction.
Ne pas attendre le benchmark d'E2 pour définir ce qui autorise à écrire E2.
Le dépôt reste aujourd'hui `template` ; aucune initialisation n'est effectuée ici.

## Preuves et traçabilité

Pour chaque étape, conserver révision produit, dépendances exactes et licences,
configuration, commandes, résultats bruts assainis et verdict lié au critère.
Chaque option rejetée a un motif concret. Les fixtures publiques restent
originales/synthétiques ; les preuves contenant des ressources de jeu restent
locales. La [stratégie qualité](02-quality-strategy.md) détaille les scénarios.

- E2 : P02, P06–P07, P10–P11, plus les essais de la matrice OS et R01–R04.
- E3 : P08–P09, P12–P14, P17–P19, P22–P23, P28 avec fixtures synthétiques.
- E4 : P01–P07, P20–P21 et E2 rejoué dans les trois modes.
- E5 : tous les scénarios applicables sans ROM, installation et refus de permissions,
  multi-écrans, verrouillage/veille/reprise, mises à jour et pertes de surface.
- E6 : P08–P09, P14–P19, P24–P28, plus la tranche d'extraction choisie.

Un seuil dépassé reste un échec même si les tests fonctionnels passent.
Les [tests de remplacement R01–R08](architecture/module-contracts.md#tests-de-remplacement)
complètent ces scénarios aux échéances indiquées ; ils ne sont pas exécutés ici.
Un module optionnel ajouté après qualification exige de rejouer les mesures
impactées. Les tests du dépôt actuel prouvent seulement le socle documentaire.

## Prochaine action

Préparer E1 : relever la machine disponible avec ses versions, choisir le premier
environnement de preuve et fixer la fiche de mesure et les budgets. Pas de ROM,
de conversion ou de fournisseur IA à choisir pour commencer.

Schéma workflow en français ; interface fixe du visualiseur en anglais (repli
Archify). HTML généré : `dist/architecture/product-roadmap.workflow.html`.
