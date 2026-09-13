# Préflight M6 — qualification matérielle

Date : 13 septembre 2026

Statut : partiel ; collecte native CPU/RSS et profilage RenderHost exécutés, énergie native encore indisponible.

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

Le package Wind Waker v53 est maintenant détecté et actif dans WallpaperAgent ;
la preuve de parentage et de catalogue est conservée dans le reçu privé
`native-live-v53.json`. Cinq échantillons CPU/RSS et un profilage `sample` de cinq
secondes sont conservés dans `active-desktop-sample-v53.json` et
`active-profile-v53.json`. Le profil montre un thread principal majoritairement en
attente et des coûts dominants dans `wgpu`/Metal (buffers et bind groups) ; aucune
optimisation spéculative n'est donc appliquée. `powermetrics` reste inutilisable
sans superutilisateur ; aucun joule, watt, GPU, wakeup ou input-to-photon n'est
publié. Spaces et multi-écran restent non sondés physiquement.

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
