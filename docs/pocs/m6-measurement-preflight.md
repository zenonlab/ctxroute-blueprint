# Préflight M6 — qualification matérielle

Date : 10 septembre 2026

Statut : non concluant ; harnais prêt, collecte native non exécutée.

## Banc observé

- Machine : MacBookPro18,3, Apple M1 Pro, 16 Go.
- Système : macOS 26.2, build 25C56.
- GPU : Apple M1 Pro, 14 cœurs.
- Écran observé : écran interne, mode 1512 × 982 à 120 Hz, un écran connecté.
- `powermetrics` : présent, mais refuse l'échantillonnage sans superutilisateur.
- Instruments : `xctrace` présent avec Power Profiler, Game Performance, Metal System
  Trace, Allocations et Time Profiler.

Les identifiants matériels uniques ne sont pas enregistrés dans Git.

## Résultat

Le contrat `measurement-receipt` impose huit scénarios, cinq passes alternées,
les valeurs brutes, moyenne, médiane, écart-type, empreintes et limitations. Ses
tests refusent un ordre non alterné et toute soumission GPU déclarée sous pause ou
occlusion.

Aucune passe native n'a été produite : le provider qualifié n'est pas installé et
actif dans WallpaperAgent, les gestes Finder/Spaces et le changement multi-écran
exigent une manipulation physique, et l'instrument énergétique disponible requiert
une élévation absente de cette exécution. Aucun joule, watt, pourcentage GPU,
wakeup, frame time ou input-to-photon n'est donc publié. Sans coût observé, aucune
optimisation M6 n'est justifiée.

## Commandes exécutées

```text
uname -a
sw_vers
system_profiler SPHardwareDataType SPDisplaysDataType -json
powermetrics -n 1 -i 100 --samplers cpu_power,gpu_power
xctrace list templates
cargo test --manifest-path pocs/theme-behavior-kernel/Cargo.toml
cargo clippy --manifest-path pocs/theme-behavior-kernel/Cargo.toml --all-targets -- -D warnings
```

La tentative `powermetrics` s'arrête avec « must be invoked as the superuser ».
Elle ne constitue pas une mesure et aucune élévation n'a été tentée.
