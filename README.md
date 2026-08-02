# FavLib

FavLib est une application privée, locale et multi-utilisateur pour suivre mangas, manhwa, manhua et anime depuis les favoris Chrome synchronisés par Google.

Chaque utilisateur installe l'extension dans son profil Chrome et l'appaire à son compte FavLib. Tous ses favoris sont examinés localement par le premier niveau de tri ; seuls les candidats médias sont envoyés à l'API. Les œuvres reconnues deviennent des abonnements surveillés.

FavLib n'héberge et ne fournit aucun contenu. Il détecte les sorties, conserve la progression déduite des favoris et ouvre la page d'origine.

Une œuvre peut regrouper plusieurs sites, langues, éditions ou groupes. FavLib met en cache uniquement métadonnées et disponibilité, puis choisit ou propose la meilleure origine au moment d'ouvrir ; aucun contenu média tiers n'est mis en cache ou servi.

PostgreSQL maintient aussi un catalogue canonique local à provenance autorisée : titres natifs, romaji, traductions, synonymes, identifiants externes, saisons et relations. Un fournisseur autorisé peut annoncer une diffusion ; la disponibilité réelle d'un épisode ou chapitre est confirmée par le connecteur du site.

## Documentation

Validation reproductible de la documentation et des fixtures :

```bash
./scripts/validate-wave-0.sh
```

- [Vision et règles produit](docs/01-produit.md)
- [Design et écrans](docs/02-design.md)
- [Architecture multi-utilisateur locale](docs/03-architecture.md)
- [Favoris, AniList, connecteurs et scraping](docs/04-sources.md)
- [Roadmap par waves](docs/05-roadmap.md)
- [Décisions actées et points ouverts](docs/06-decisions.md)
- [Plan de test de chaque wave](docs/07-waves-et-tests.md)
- [Checklist transversale complète](docs/08-checklist-transversale.md)
- [Wireframes Wave 0](docs/09-maquettes-wireframes.md)
- [Exploitation locale et sauvegardes](docs/10-exploitation-locale.md)
- [Contrat et responsabilités de l'API](docs/11-api.md)
- [APIs, fournisseurs, langages et stack vérifiés](docs/12-api-fournisseurs-et-stack.md)
- [Jeux de données, dumps et imports locaux](docs/13-jeux-de-donnees-et-imports.md)
- [Audit sauvegardes, limites API, logique et extension](docs/14-audit-sauvegardes-api-extension.md)
- [Préparation du démarrage de l'implémentation](docs/15-preparation-demarrage.md)
- [Modèle de menace](docs/16-modele-de-menace.md)
- [Décisions d'architecture](docs/adr/README.md)
- [Validation de la Wave 0](docs/VALIDATION-WAVE-0.md)

## Boucle métier

```text
favoris Chrome de chaque utilisateur
  → extension appairée
  → examen local idempotent de tous les favoris
  → candidats médias → tri API/site + matching catalogue local/fournisseur autorisé
  → œuvre + source suivie
  → découverte bornée + validation d'alternatives
  → worker public mutualisé ou extension privée best effort
  → regroupement des origines par sortie
  → nouvelle sortie + alternatives dans l'inbox
```

Un favori vers une fiche d'œuvre signifie « je suis cette œuvre ». Un favori vers un chapitre ou épisode précis indique également une position. Après consentement, l'extension peut aussi observer une page suivante appartenant à cette même œuvre favorite et avancer une progression marquée « observée ». La nouveauté disponible est détectée par le connecteur du site, pas par une modification du favori.

Le projet reste privé. L'hébergement cloud et l'inscription publique sont hors périmètre pour le moment.
