# PoC E6-A1 — frontend Libretro déterministe

Ce PoC valide uniquement le contrat d'observation hors ligne de
[l'ADR-0056](../../docs/decisions/ADR-0056-emulator-assisted-offline-observation.md).
Il charge un core Libretro local, fournit une entrée en mémoire, applique une
séquence d'inputs bornée et capture vidéo, audio, état sérialisé et mémoire.

Le core C inclus est une fixture originale et libre de donnée commerciale. Il ne
simule aucune console. Son rôle est de tester le frontend, l'ABI, la répétabilité et
le manifeste avant d'autoriser un vrai core local.

## Exécution

```bash
bash pocs/emulator-observer/test.sh
```

Le test compile la fixture, exécute cinq observations de douze frames, compare les
SHA-256, tailles, métadonnées et capacités, puis vérifie trois refus de sûreté. Les sorties restent dans un dossier
unique sous `dist/pocs/` afin que la preuve soit inspectable ; le script ne supprime
rien et n'accède pas au réseau.

## Limites fermées

- seuls les cores API v1, contenu chargé en mémoire et frames logicielles XRGB8888
  sont acceptés dans cette tranche ;
- un core demandant un contexte GPU ou un chemin complet est refusé ;
- une frame manquante ou multiple, un symbole absent ou un état non sérialisable
  échoue explicitement ;
- aucun concept de scène, collision ou gameplay n'est inféré depuis les pixels ;
- `ctypes` charge le core dans le processus observateur : cette tranche ne confine
  donc pas encore un core tiers et publie cette capacité comme `unknown` ;
- la prochaine preuve E6-B doit sélectionner un core et une fixture homebrew
  redistribuable, et E6-A2 doit exécuter ce même runner dans la sandbox OS sans
  réseau avant de déclarer E6-A complètement réussi ;
  un observateur spécialisé n'est ajouté que si la question l'exige.

La documentation officielle confirme l'ordre des appels, le modèle mono-instance,
les callbacks et l'absence de garantie de thread-safety :
[Core Development Overview](https://docs.libretro.com/development/cores/developing-cores/),
[libretro.h canonique](https://github.com/libretro/libretro-common/blob/master/include/libretro.h),
[libretro-samples](https://github.com/libretro/libretro-samples).
