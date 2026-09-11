# Correction méthodique

## Objectif

Une correction doit réparer la première couche fautive et produire une preuve
rejouable. Un ajustement visuel sans source, un binaire seulement compilé ou une
capture issue d'un ancien processus ne constituent pas une correction.

Le protocole s'applique aux thèmes, adaptateurs, runtimes, connecteurs et outils de
préparation. Il reste indépendant du jeu, du renderer et du système d'exploitation.

## Parcours obligatoire

1. Reproduire un symptôme unique avec une entrée et un résultat attendus précis.
2. Produire le reçu de l'artefact actif avant toute modification.
3. Identifier la source de vérité et son espace de coordonnées éventuel.
4. Tracer chaque transformation jusqu'au pixel, événement ou état incorrect.
5. Écrire une hypothèse falsifiable et choisir une seule couche propriétaire.
6. Ajouter le test qui échoue au niveau de cette couche.
7. Appliquer le changement minimal puis régénérer les dérivés.
8. Vérifier les hashes, arrêter l'ancien processus borné et activer une seule fois.
9. Exécuter les tests ciblés puis la matrice de régression.
10. Capturer les observations requises et rendre un verdict explicite.

Deux échecs de la même hypothèse interrompent la boucle. Le diagnostic repart de la
source ; aucune nouvelle constante compensatoire n'est ajoutée.

## Classification de la couche propriétaire

| Signal | Couche |
| --- | --- |
| Octets ou tables mal interprétés | adaptateur source |
| Sémantique réelle impossible à représenter | contrat canonique |
| Donnée canonique correcte, résultat transformé incorrect | runtime |
| Permissions, fenêtres, processus ou OS | connecteur |
| Résolution locale ou asset absent | package privé |

La correction reste dans cette couche. Une perte de rotation dans l'adaptateur ne se
compense pas par un offset dans le renderer.

## Données générées

Chaque valeur dérivée importante conserve l'adaptateur, sa version, le hash de la
source, la table ou le champ, l'index ou l'offset, l'unité, l'espace source et la
transformation appliquée. Une valeur observée manuellement porte `experimental` et
ne peut pas entrer dans un reçu `qualified`.

Les cardinalités sont exactes. Une collection vide reste vide ; une sortie unique
n'est pas dupliquée pour satisfaire un tableau de taille deux. `missing`,
`unsupported` et `unknown` restent distincts.

### Relations et placements dérivés

Toute relation variant selon plusieurs ressources est matérialisée dans un manifeste
`orbite.source-relations/1`. Ses axes sont ouverts : acteur, support, état, variante,
équipement ou toute autre dimension décrite par la source. Le validateur exige une
cellule pour chaque combinaison et chaque type de relation déclaré. Une relation
absente est `missing`, `unsupported`, `unknown` ou `not_applicable` avec sa preuve ;
elle ne reçoit jamais une valeur par défaut implicite.

Chercher les preuves dans cet ordre : table source, métadonnée source, puis code ou
script source exporté en lecture seule. Quand aucune table n'existe, l'adaptateur
transforme les branches du code exporté en lignes explicites et conserve symbole,
hash de source, exporteur, version et étapes de dérivation. La géométrie et
l'observation peuvent produire un diagnostic `partial`, jamais un statut `qualified`.
Le code exporté, les octets et les résultats privés restent hors Git ; le template ne
contient que le contrat, le validateur et des fixtures libres.

Chaque placement conserve position, rotation, échelle, unité et espace de coordonnées.
Les conversions d'axe ou d'unité appartiennent à l'adaptateur et sont testées une fois.
Le renderer consomme ces relations ; il ne reconnaît aucune catégorie de jeu et ne
possède aucun offset, socket ou multiplicateur de secours.

```bash
node scripts/verify-source-relations.mjs /chemin/source-relations.json
```

### Qualification visuelle matricielle

Une capture portant le nom d'un état ne prouve ni la présence ni la fidélité de son
résultat. Le reçu `orbite.visual-qualification/2` déclare ses axes et couvre leur
produit cartésien. Chaque cellule lie l'oracle et la capture par SHA-256 et vérifie les
assertions demandées : visibilité, origine, échelle, densité, orientation, apparence,
timing et occlusion. `qualified` exige toutes les cellules et assertions en succès.

```bash
node scripts/verify-visual-qualification.mjs /chemin/visual-qualification.json
```

## Menus automatiques

Le connecteur construit les menus à partir des étapes et capacités du manifeste.
Une étape déclare sa catégorie, son libellé, son ordre, sa présentation et ses règles
de compatibilité. Ajouter `outfit`, `companion`, `vehicle` ou `scene` ne demande
aucune branche dans AppKit.

Le préparateur génère les choix depuis le catalogue canonique et les axes de relations
résolus. Chaque catégorie reste un identifiant ouvert. Une variante sans cellule
qualifiée est exclue avec diagnostic ; elle n'est ni masquée silencieusement après le
clic, ni compensée par le premier modèle compatible. L'interface transporte uniquement
les étapes, choix, attributs et compatibilités ; le connecteur ne déduit rien des noms
de fichiers et ne possède aucune liste de catégories métier.

Les contrôles système proviennent du catalogue de capacités. Leur comportement est
stable et leur peau appartient au thème. Une capacité absente ne crée aucun bouton ;
une capacité déclarée sans asset, état accessible ou action typée fait échouer la
validation.

## Commandes

```bash
node scripts/verify-active-theme.mjs --package /chemin/orbite-theme.json \
  --binary /chemin/renderhost --pid 1234 --output /chemin/active-receipt.json

node scripts/verify-correction-record.mjs /chemin/correction-record.json
```

Le premier outil ne démarre et n'arrête aucun processus. Son reçu v2 prouve
l'intégrité des artefacts actifs et conserve la qualification à `unreviewed` ; il ne
confond plus chargement réussi et fidélité. Le second vérifie la complétude et la
cohérence des preuves ; il ne prétend pas inspecter les pixels.

Les structures attendues sont dans
[correction-record.schema.json](templates/correction-record.schema.json),
[source-relations.schema.json](templates/source-relations.schema.json),
[visual-qualification.schema.json](templates/visual-qualification.schema.json) et
leurs exemples synthétiques voisins. Le menu déclaratif est documenté par
[theme-interface-v5.schema.json](templates/theme-interface-v5.schema.json) et son
[exemple sans catégorie de jeu](templates/theme-interface-v5.example.json).
