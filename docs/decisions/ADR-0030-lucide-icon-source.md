---
scope:
  - packages/ui/
  - package.json
  - package-lock.json
  - docs/architecture/src/ui-system.architecture.json
review: on-change
---

# ADR-0030 — Lucide comme source unique des icônes UI

- Status: accepted
- Date: 2026-09-03

## Contexte

Tobirink a besoin d’une convention d’icônes stable entre le workbench, les
primitives et les futures surfaces de l’extension. FavLib mélangeait des imports
React, des imports DOM, des SVG recopiés et des symboles textuels, ce qui rendait
la source et l’accessibilité difficiles à vérifier.

## Décision

Utiliser `lucide-react` 1.40.0 comme source externe unique derrière le composant
public `Icon` de `@tobirink/ui`. Le registre initial expose les trente-cinq
icônes utilisées ou prévues dans FavLib et les trois besoins génériques validés
pour les primitives Tobirink.

Importer chaque pictogramme par son export nommé. Ne jamais charger la totalité
du catalogue dynamiquement. Les composants produit consomment `Icon` et ses noms
typés depuis l’API publique Tobirink ; ils n’importent pas directement Lucide.
Une icône décorative reste masquée des technologies d’assistance. Une icône qui
porte une information reçoit un libellé explicite.

## Alternatives

Maintenir des tracés SVG locaux dupliquerait une bibliothèque existante et
réintroduirait plusieurs conventions. Exposer directement tous les composants
Lucide dans les surfaces couplerait le produit au fournisseur et agrandirait
l’API sans besoin observé.

## Conséquences

Le trait, les tailles et l’accessibilité restent pilotés par les tokens et le
composant `Icon`. Changer de bibliothèque reste local au package UI. Chaque
nouvelle icône doit correspondre à un usage réel, rejoindre le registre typé et
apparaître dans la preview isolée.
