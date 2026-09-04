# Workflow: écrire et réutiliser une décision persistante

Une décision d’architecture, de contrat, de sécurité, de dépendance ou de
contrainte majeure doit être conservée dans `docs/decisions/`.

## Écriture

1. Identifier la décision durable et créer ou réviser un ADR numéroté.
2. Ajouter le front matter YAML : `scope` obligatoire, `contracts` optionnel,
   et `review: on-change`, `manual` ou `never`.
3. Utiliser des chemins relatifs au dépôt ; `*` correspond à un segment et `**`
   à plusieurs segments.
4. Pour une révision, conserver l’ADR et ajouter `revised: true`. Pour un
   remplacement, conserver l’ADR et ajouter `superseded-by: ADR-XXXX-name.md`.
5. Modifier le code ou le contrat dans la même étape, puis lancer
   `npm run validate:decisions`.

## Réutilisation automatique

Avant une modification, `PreToolUse` extrait les fichiers ciblés et nomme dans
un résumé borné les ADRs dont le périmètre correspond. L’agent relit uniquement
les décisions utiles si la modification touche réellement une frontière, un
contrat, une dépendance ou un flux inter-composants. Les corps complets ne sont
jamais injectés automatiquement.

Après une modification, `PostToolUse` vérifie qu’un changement architectural
ou de contrat possède une décision valide. Les tests et fichiers générés sont
exemptés. Une décision invalide, absente ou contradictoire produit un blocage
explicite ; le hook ne fabrique jamais automatiquement un ADR.

## Vérification

```sh
npm run validate:decisions
npm test
```

Le flux canonique est : changement → sélection des noms ADR → lecture à la
demande si matérielle → validation.

Les protections issues de la mémoire des problèmes suivent le même principe :
SQLite détecte et résout le problème, puis CTXRoute injecte une règle approuvée
scopée par fichier et outil. La règle contient uniquement le vocabulaire
CTXRoute (`tool`, `scope`, `mode`) ; elle ne contient pas `problem-memory`,
`events` ou `tools`, et ne modifie jamais automatiquement `AGENTS.md`.

Les ADRs valides sont indexés par des documents CTXRoute inactifs dans
`.claude/hooks/docs/adr-memory/`. Le hook local conserve la correspondance par
scope et les blocages de gouvernance sans y copier le corps des ADRs.

Un ADR invalide ou remplacé bloque une modification gouvernée. Plusieurs ADRs
applicables produisent le statut `partial` et un diagnostic explicite ; la
contradiction sémantique entre leurs textes reste hors périmètre sans
analyseur dédié.
