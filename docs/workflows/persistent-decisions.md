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

Avant une modification, `PreToolUse` extrait les fichiers ciblés, sélectionne
les ADRs dont le périmètre correspond et injecte leur contenu dans le contexte.
L’agent doit relire ces décisions avant d’agir.

Après une modification, `PostToolUse` vérifie qu’un changement architectural
ou de contrat possède une décision valide. Les tests et fichiers générés sont
exemptés. Une décision invalide, absente ou contradictoire produit un blocage
explicite ; le hook ne fabrique jamais automatiquement un ADR.

## Vérification

```sh
npm run validate:decisions
npm test
```

Le flux canonique est : changement → sélection ADR → injection du contexte →
validation.
