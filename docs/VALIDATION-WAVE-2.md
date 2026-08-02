# Validation Wave 2 — interface contractuelle

État au 2026-08-02 : interface Web synthétique livrée et vérifiée localement.

## Périmètre livré

- Shell responsive : sidebar desktop, barre inférieure mobile, thème sombre par défaut, tokens CSS sémantiques et navigation Accueil, Bibliothèque, Calendrier, À vérifier, Sources, Réglages.
- Vues locales : inbox, bibliothèque filtrable, fiche œuvre, calendrier, candidats ambigus, diagnostics de sources, sessions/appareils et administration.
- Les données sont les fixtures de démonstration Alice/Bob et ne contiennent ni URL personnelle réelle ni média tiers.
- Les états `Planifié`, `Disponible`, `Obsolète`, `Erreur`, `Sain` et `À vérifier` sont affichés séparément. Une sortie planifiée ne propose aucune ouverture.
- Le profil admin est isolé de la bibliothèque personnelle ; le sélecteur de profil est un outil de démonstration, en attendant le branchement à la session Wave 1.

## Commandes et preuves

```text
corepack pnpm typecheck       ✅
corepack pnpm lint            ✅
corepack pnpm test            ✅
corepack pnpm test:e2e        ✅ attendu avec Chromium installé
corepack pnpm --filter @favlib/web build ✅
```

Le test Playwright `apps/web/e2e/wave-2.spec.ts` couvre les parcours inbox → bibliothèque → fiche, l'absence de bouton pour `Planifié`, la source cassée, l'accès admin et la navigation mobile. Le projet Playwright lance le serveur Next local sur `127.0.0.1:3000`.

## Limites connues

- Le shell utilise des pictogrammes texte et des CSS possédés par FavLib ; le remplacement par les composants shadcn/Radix et Lucide est volontairement différé tant que les contrats d'API Web ne sont pas branchés.
- Le changement Alice/admin est un commutateur de démonstration stocké dans `localStorage`. Il ne remplace pas l'autorisation serveur de Wave 1.
- Les boutons de synchronisation, confirmation, export et ouverture donnent un retour synthétique et ne déclenchent aucune mutation métier ni navigation fournisseur.
- La couverture des états offline/loading/permissionDenied est représentée par les panneaux et badges contractuels ; la télémétrie et les appels TanStack Query seront ajoutés avec les adaptateurs API.

## Retour arrière

Supprimer les fichiers ajoutés sous `apps/web/app`, `apps/web/e2e`, `apps/web/playwright.config.ts` et `docs/VALIDATION-WAVE-2.md`, puis restaurer les scripts et la dépendance `@playwright/test` dans les deux manifests ainsi que le lockfile avec une copie de la branche Wave 1. Aucun schéma, favori, connecteur ou donnée externe n'a été modifié par cette wave.
