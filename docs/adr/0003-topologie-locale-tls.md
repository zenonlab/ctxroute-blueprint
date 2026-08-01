# ADR 0003 — Topologie locale et TLS

- Statut : accepté
- Date : 2026-08-02

## Décision

L'origine de référence est configurable par `FAVLIB_PUBLIC_ORIGIN` et vaut par défaut :

```text
https://favlib.home.arpa
```

Le DNS local du routeur ou un résolveur du LAN fait pointer `favlib.home.arpa` vers la machine hôte. Aucun port n'est redirigé depuis Internet.

Caddy est l'unique entrée réseau :

```text
https://favlib.home.arpa/
  /api/* → Fastify
  /*      → Next.js
```

Caddy utilise `tls internal`. Dans Docker, la racine de la CA est exportée depuis le volume Caddy puis installée explicitement dans le trust store de chaque appareil client et, si nécessaire, du navigateur. La clé privée de CA n'est jamais exportée ni commitée.

Le Web et l'API utilisent la même origine. Les sessions Web passent par cookie sécurisé ; l'extension utilise un jeton d'appareil dans `Authorization`. CORS autorise uniquement l'origine Web configurée et les IDs d'extension explicitement listés. Les mutations Web utilisent une protection CSRF adaptée aux cookies.

L'extension demande à l'exécution la permission exacte `https://favlib.home.arpa/*`. Une origine différente exige une nouvelle permission explicite.

## Déploiement

- Caddy écoute sur l'interface LAN configurée ; PostgreSQL, Web, API et worker ne publient aucun port hôte.
- Le pare-feu limite 443 au réseau local autorisé.
- L'appairage est refusé si le certificat n'est pas fiable.
- L'accès distant futur utilisera un ADR séparé, par exemple Tailscale, et ne réutilisera pas implicitement ce modèle LAN.

## Conséquences

La configuration demande une étape d'installation de certificat par appareil, mais protège mots de passe, favoris reconnus et jetons sur le réseau local.
