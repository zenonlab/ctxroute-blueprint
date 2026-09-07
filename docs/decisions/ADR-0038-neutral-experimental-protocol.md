---
scope:
  - docs/04-experimental-protocol.md
  - docs/research/architecture-audit-synthesis.md
  - docs/architecture/runtime-infrastructure.md
  - docs/architecture/module-contracts.md
  - docs/architecture/src/runtime-infrastructure.architecture.json
review: on-change
---
# ADR-0038 — Audit contradictoire et protocole expérimental neutre

- Status: accepted
- Date: 2026-09-07

## Context

Les audits externes mêlent corrections valides, descriptions inexactes du dépôt
et estimations non mesurées. Ils ne justifient ni une adoption de stack ni une
réduction silencieuse des capacités de thèmes.

## Decision

Conserver C0–C6 et les frontières existantes. Documenter l'autonomie du wallpaper,
ses actions locales autorisées et le caractère conditionnel des sessions.
L'isolation visée protège les shells d'une panne du wallpaper ; aucune persistance
universelle n'en découle. Le contrôle local n'impose pas un troisième démon.

Adopter une méthode comparative avec référence énergétique native, mesures
répétées, périmètre fonctionnel explicite et critères définis avant expérimentation.
Les trois axes sont rendu, terminal et ancrage OS, complétés par les essais de
domaines de panne. Préserver l'ordre E1–E6 et limiter les finalistes à éprouver.

## Consequences

Aucun abandon de WebView, adoption de Wasm, remplacement général de la 3D par vidéo,
ou support OS complet n'est décidé. La stack reste à qualifier, sans installation
de dépendance produit. L'ingestion reste locale, séparée et optionnelle.
Le dépôt reste `template` ; ce travail documentaire n'est pas une initialisation
ni une preuve de performance. Un ADR ultérieur devra citer les résultats réels
pour adopter une technologie. La proposition externe d'un ADR-0038 imposant un
terminal natif n'est pas retenue ; le présent ADR décide uniquement la méthode.
