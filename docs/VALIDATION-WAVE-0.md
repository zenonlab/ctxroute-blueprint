# Validation Wave 0

## État

- Revue documentaire technique : complète le 2026-08-02.
- Validation utilisateur : en attente.
- Tag `wave-0-docs` : interdit tant que la validation utilisateur n'est pas enregistrée.

Gate mécanique locale : `./scripts/validate-wave-0.sh`. Elle valide le diff, JSON/NDJSON, manifest/checksum, scénarios Given/When/Then, liens et index ; elle ne constitue pas un test runtime.

## Artefacts disponibles

- doctrine [CLAUDE.md](../CLAUDE.md) ;
- décisions [ADR](adr/README.md) ;
- corpus [favoris synthétiques](../fixtures/bookmarks/wave-0.synthetic.json) ;
- catalogue [multi-alias synthétique](../fixtures/catalog/wave-0.media-aliases.json) ;
- dataset [manifest + records NDJSON synthétiques](../fixtures/catalog/wave-0.dataset-manifest.json) ;
- candidates [de découverte synthétiques](../fixtures/discovery/wave-0.discovery.json) ;
- fixtures [source de référence](../fixtures/sources/reference/) ;
- scénarios [Given/When/Then](../fixtures/scenarios/wave-0.feature) ;
- [wireframes](09-maquettes-wireframes.md) ;
- [roadmap](05-roadmap.md) et [tests](07-waves-et-tests.md) ;
- [contrat API](11-api.md) ;
- [matrice APIs, fournisseurs et stack](12-api-fournisseurs-et-stack.md) ;
- [matrice des jeux de données et imports locaux](13-jeux-de-donnees-et-imports.md) ;
- [audit sauvegardes, limites API, logique et extension](14-audit-sauvegardes-api-extension.md) ;
- [préparation du démarrage de l'implémentation](15-preparation-demarrage.md) ;
- [modèle de menace](16-modele-de-menace.md) ;
- [checklist transversale](08-checklist-transversale.md).

## Corrections issues de l'audit

| Risque | Décision corrective | État documentaire |
|---|---|---|
| favori immobile donc progression figée | progression contextuelle consentie, sans écriture Chrome | corrigé par ADR 0001 |
| envoi de tous les favoris lisibles | examen local complet, envoi des seuls candidats | corrigé par ADR 0002 |
| HTTPS LAN non défini | Caddy, `favlib.home.arpa`, CA interne et même origine | corrigé par ADR 0003 |
| mutualisation uniquement par URL | contexte connecteur/version/locale/région/mode | corrigé par ADR 0004 |
| ordre global par simple numéro | release et curseur structurés par séquence | corrigé par ADR 0005 |
| file et versioning ambigus | Graphile Worker et workflow Git par waves | corrigé par ADR 0006/0007 |
| doctrine absente | règles obligatoires à la racine | corrigé par CLAUDE.md |
| cache et bascule de source incomplets | cache contextualisé et résolveur explicable | corrigé par ADR 0008/0009 |
| reconnaissance multi-nom et signal de sortie incomplets | catalogue canonique et séparation annonce/origine | corrigé par ADR 0010 |
| découverte et surveillance d'alternatives imprécises | triggers, validation, états, budgets et notifications | corrigé par ADR 0011 |
| rétention AniList non autorisée | fournisseurs bloqués par défaut, provenance et purge | corrigé par ADR 0012 |
| surveillance privée imprécise | alarmes, lease, reprise hors ligne et état périmé | corrigé par ADR 0013 |
| grande base réduite à des APIs | releases/dumps MADB, Wikidata, BnF, NDL et IMDb optionnel avec import atomique | corrigé par la matrice datasets et l'architecture Wave 4 |
| contrat de sortie incomplet | identité structurée et représentation complète dans `CheckResult` | corrigé par ADR 0005 et contrat connecteur |
| preuves incompatibles avec les fixtures | acquisition et matching séparés, fixture version 2 | corrigé par contrat connecteur |
| sauvegarde déclarée saine sans preuve | statut sain seulement après checksum, déchiffrement et restauration sur base neuve | corrigé par exploitation, roadmap et scénarios |
| quotas fournisseurs incomplets | limite inconnue = `REVIEW_REQUIRED`, aucun job planifié | corrigé par ADR 0012 et matrice fournisseurs |
| promesse MV3 trop forte | worker jetable, file persistée, budget 5 Mio et `WAITING_FOR_VISIT` pour l'auth non observable | corrigé par ADR 0013 et ADR 0008 |
| auth locale sous-spécifiée | bootstrap, Argon2id, sessions, CSRF, invitations, récupération et appairage figés | corrigé par ADR 0014 |
| suppression/restauration ambiguë | rétentions, export, tombstones et non-résurrection définis | corrigé par ADR 0015 |
| menaces dispersées | acteurs, frontières, contrôles, risques acceptés et gates regroupés | corrigé par le modèle de menace |
| démarrage sans Definition of Ready | prérequis, configuration, ordre Wave 1 et preuves attendues explicités | corrigé par le guide de préparation |

## Checklist d'acceptation utilisateur

- [ ] Le favori reste obligatoire pour suivre une œuvre.
- [ ] Tous les favoris sont examinés localement, mais seuls les candidats médias sont envoyés.
- [ ] L'extension ne modifie jamais les favoris Chrome.
- [ ] La progression contextuelle consentie est acceptée comme progression « observée ».
- [ ] L'administrateur de la machine locale est reconnu comme autorité de confiance.
- [ ] L'installation d'un certificat Caddy sur chaque appareil local est acceptable.
- [ ] Le découpage des waves et les wireframes sont approuvés.
- [ ] Le cache sans média tiers et le menu multi-source/fallback sont approuvés.
- [ ] Le catalogue local multi-alias et la distinction « annoncé »/« disponible » sont approuvés.
- [ ] La découverte bornée, l'épinglage d'alternatives et les règles de notification sont approuvés.
- [ ] AniList désactivé avant autorisation et le catalogue à provenance autorisée sont approuvés.
- [ ] La surveillance privée best effort et ses états hors ligne/périmés sont approuvés.
- [ ] Une page authentifiée non observable sans visite peut rester `WAITING_FOR_VISIT` sans détection continue.
- [ ] Le budget extension de 5 Mio, la réconciliation après overflow et l'absence de `unlimitedStorage` sont approuvés.
- [ ] Les objectifs RPO 24 h/RTO 4 h restent `NOT_VERIFIED` jusqu'à une restauration réelle ; stockage distinct et clé hors hôte sont acceptés.
- [ ] Un fournisseur sans quota vérifié, dont MangaUpdates actuellement, reste désactivé pour les jobs planifiés.
- [ ] Le bootstrap administrateur, Argon2id, les durées de session et la récupération locale définis par ADR 0014 sont approuvés.
- [ ] Les rétentions, exports, suppressions et tombstones définis par ADR 0015 sont approuvés.
- [ ] Les risques acceptés du modèle de menace, notamment la confiance dans l'administrateur hôte et le profil Chrome, sont approuvés.
- [ ] Le socle téléchargeable MADB/Wikidata/BnF/NDL, IMDb optionnel isolé et NLK à qualifier sont approuvés.
- [ ] Le pipeline release/checksum/staging/assertions/rollback est approuvé.
- [ ] Les rôles futurs de TVmaze et MangaUpdates — sans preuve de disponibilité et seulement après politique `AUTHORIZED` — sont approuvés.
- [ ] TypeScript/Node.js 24, PostgreSQL 18 et la distribution privée proposée pour l'extension sont approuvés.

Une fois ces points confirmés par l'utilisateur, mettre à jour le registre de validation et créer le tag `wave-0-docs`.
