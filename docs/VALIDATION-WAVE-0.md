# Validation Wave 0

## État

- Revue documentaire technique : complète le 2026-08-02.
- Validation utilisateur : en attente.
- Tag `wave-0-docs` : interdit tant que la validation utilisateur n'est pas enregistrée.

## Artefacts disponibles

- doctrine [CLAUDE.md](../CLAUDE.md) ;
- décisions [ADR](adr/README.md) ;
- corpus [favoris synthétiques](../fixtures/bookmarks/wave-0.synthetic.json) ;
- catalogue [multi-alias synthétique](../fixtures/catalog/wave-0.media-aliases.json) ;
- candidates [de découverte synthétiques](../fixtures/discovery/wave-0.discovery.json) ;
- fixtures [source de référence](../fixtures/sources/reference/) ;
- scénarios [Given/When/Then](../fixtures/scenarios/wave-0.feature) ;
- [wireframes](09-maquettes-wireframes.md) ;
- [roadmap](05-roadmap.md) et [tests](07-waves-et-tests.md) ;
- [contrat API](11-api.md) ;
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

Une fois ces points confirmés par l'utilisateur, mettre à jour le registre de validation et créer le tag `wave-0-docs`.
