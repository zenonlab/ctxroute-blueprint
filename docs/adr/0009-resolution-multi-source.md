# ADR 0009 — Résolution multi-source

- Statut : accepté
- Date : 2026-08-02

## Objectif

Proposer, pour une même œuvre et une même sortie logique, plusieurs sites, langues, éditions ou groupes, avec un changement de source rapide, sans héberger les contenus.

## Modèle

```text
media canonique
  └─ release logique : chapitre 42
      ├─ origin A : site officiel · FR
      ├─ origin B : autre site favori · EN
      └─ origin C : groupe/source différente · EN
```

Les origines sont regroupées grâce à l'identité structurée de l'ADR 0005. Une origine reste un lien vers son site et conserve langue, édition, groupe, santé et date.

## Sources candidates

Une alternative peut provenir :

1. d'un autre favori du même utilisateur déjà rattaché à l'œuvre ;
2. d'une cible publique déjà reconnue pour la même œuvre sur l'instance ;
3. d'une recherche proposée par une API officielle ou un connecteur de catalogue explicitement autorisé ;
4. d'une migration de domaine/URL validée par redirection, canonical ou matching fort.

Une cible découverte chez un autre utilisateur n'expose jamais son favori ou son identité. Elle n'est proposée que si elle est publique, autorisée et retrouvable indépendamment par le connecteur.

Le résolveur enrichit seulement une œuvre déjà ancrée dans les favoris personnels. Une candidate ne crée jamais seule une œuvre de bibliothèque, un `user_subscription` ou un favori Chrome.

FavLib ne recherche pas arbitrairement des copies de contenus sur le Web et n'utilise aucune API non documentée. Une nouvelle origine devient un connecteur uniquement après vérification de son service, de ses conditions et d'une méthode autorisée.

## Préférences utilisateur

Les préférences sont définissables globalement puis surchargeables par œuvre :

- source épinglée ;
- langue et région ;
- officiel/licencié prioritaire lorsque cette propriété est fournie de manière fiable ;
- éditions ou groupes favoris/bloqués ;
- fallback automatique autorisé ou non ;
- sources privées jamais utilisées comme fallback partagé.

## Score de résolution

Au moment d'ouvrir une sortie, le résolveur classe les origines compatibles selon :

1. source épinglée pour l'œuvre ;
2. sortie exacte après la progression, sans saut de séquence ;
3. langue/région préférée ;
4. statut officiel/licencié vérifié ;
5. continuité des sorties autour de la progression ;
6. santé et succès récent du connecteur ;
7. fraîcheur de la vérification ;
8. préférence de groupe/édition.

Chaque décision conserve ses raisons. Un fallback est affiché comme tel et ne devient pas la préférence permanente sans choix utilisateur.

## Changement et migration

### Changement ponctuel

La ligne de sortie propose « Sources (N) ». L'utilisateur ouvre une origine précise sans changer la source préférée.

### Source indisponible

Si la source préférée est cassée ou ne possède pas la prochaine sortie, FavLib propose la meilleure alternative. Le fallback automatique n'est utilisé que si la préférence l'autorise.

### Domaine ou URL migré

`source_alias` conserve ancienne origine, nouvelle origine, preuve, score et date. FavLib migre sa cible interne après validation forte, garde l'historique et informe l'utilisateur. Puisque l'arbre Chrome est en lecture seule, l'extension propose d'ouvrir la nouvelle page mais ne réécrit pas le favori.

## Garde-fous

- aucune progression avancée par un simple changement de source ;
- aucune comparaison numérique entre saisons/séquences différentes ;
- aucune origine personnalisée mutualisée ;
- source cassée distincte d'une sortie absente ;
- alternative obsolète signalée ;
- pas de copie, proxy ou cache du contenu média.

## Conséquences

FavLib devient un index personnel multi-source et un routeur de liens. La disponibilité peut être riche comme sur un agrégateur, mais la lecture et la responsabilité du contenu restent sur les sites d'origine.
