---
scope:
  - packages/application/src/public-discovery/**
  - packages/adapters-browser/src/catalogue/**
  - packages/adapters-cloudflare/src/catalogue/**
  - packages/adapters-indexeddb/src/**
  - apps/extension/wxt-entrypoints/background.ts
  - apps/worker/migrations/**
  - apps/worker/src/catalogue/**
  - apps/worker/src/releases/**
  - .github/workflows/**
  - scripts/agenda-collector/**
  - docs/systems/favorite-resolution-rebuild-pipeline.md
  - docs/systems/agenda-recovery-plan.md
  - docs/architecture/src/favorite-resolution.dataflow.json
  - docs/architecture/src/tobirink.architecture.json
review: on-change
---

# ADR-0046 — Cache public de découverte vérifié sans propriétaire

- Status: accepted
- Date: 2026-09-14
- Supersedes: le protocole Collectif, les owners et les confirmations humaines de l’ADR-0043; l’identité collective de l’ADR-0044

## Contexte

Un cache D1 ne réduit les recherches que s’il est alimenté. Autoriser une
extension à publier directement titres, profils ou associations fournisseur
permet toutefois d’empoisonner le catalogue. Une identité d’installation, un
appairage ou deux prétendus propriétaires ne prouvent ni l’indépendance des
personnes ni la validité d’une fiche publique.

Le besoin est de réutiliser une œuvre déjà résolue sans envoyer l’URL, le titre
brut, le dossier, la progression ou une bibliothèque. Une garantie absolue de
« jamais deux recherches », y compris après crash ou abandon du premier client,
est impossible : un verrou qui n’expire jamais bloquerait définitivement la
clé. La garantie utile est une seule recherche textuelle concurrente par clé,
aucune nouvelle recherche textuelle après validation, et une reprise bornée
après expiration d’un travail inachevé.

## Décision

Le protocole public utilise une clé versionnée composée de l’empreinte SHA-256
du titre canonique local, du type média, de la version du parseur et de la
version des règles. Cette empreinte est devinable pour un titre connu : elle
n’est donc pas présentée comme anonyme. Le Worker et D1 ne lui associent aucun
owner, installation, compte, URL, dossier, progression ou décision privée. Les
logs applicatifs n’enregistrent ni clé, ni référence proposée, ni jeton de bail.

Une lecture renvoie exactement un état :

- `MISS` : aucune association ni demande active;
- `PENDING` : une demande bornée existe, mais aucune donnée n’est fiable;
- `VERIFIED` : un collecteur autorisé a validé et publié les références et le
  profil fournisseur officiels.

Sur `MISS`, le Worker crée atomiquement une demande ou retourne la demande
concurrente déjà créée. Un seul appel obtient un bail opaque court. Ce reçu
éphémère n’est pas une identité et n’accorde aucun droit de publication. Son
titulaire peut effectuer la recherche textuelle fournisseur et proposer
uniquement des couples `(provider, providerWorkId)`. Il n’envoie aucun titre,
alias, URL de favori, facette, image ou payload fournisseur. Une proposition
est non fiable et n’est jamais servie comme résultat catalogue.

Le collecteur GitHub déjà authentifié par OIDC réclame les demandes en attente,
hydrate chaque identifiant auprès du fournisseur exact et applique les mêmes
bounds de schéma. Il recalcule les empreintes de tous les titres officiels
bornés. Il ne promeut `VERIFIED` que si l’une d’elles correspond exactement à
la clé demandée et si les références ne sont pas en conflit. Le Worker vérifie
signature, issuer, audience, dépôt, branche et workflow avant toute promotion;
il demeure l’unique auteur des tables publiques fiables.

La clé D1 possède un index unique. Claim, proposition et promotion sont
idempotents. Un seul bail non expiré peut être actif; les autres clients voient
`PENDING` et n’appellent pas la recherche textuelle. Une promotion rejouée avec
le même digest ne change rien. Un conflit, un profil invalide ou une lane
incomplète reste non publié. Après expiration, un claim peut être repris avec
un compteur et une échéance bornés; c’est le seul cas normal où une recherche
peut être répétée.

L’extension consulte d’abord IndexedDB, puis `storage.sync`, puis D1. Un
`VERIFIED` évite la recherche textuelle et poursuit par hydratation exacte si la
fiche locale manque. Sur `PENDING`, elle conserve la source locale et programme
une relecture sans fournisseur. Sur bail accordé, elle persiste le reçu et le
résultat local avant de proposer les seuls identifiants publics. Un réveil MV3
reprend cet état au lieu de créer une seconde demande.

Le protocole ne possède aucun réglage Collectif, appairage ou consentement
produit spécifique. La permission navigateur native `bookmarks` et la
déclaration de collecte exigée par les boutiques restent exactes tant que
l’extension lit les favoris. La politique de confidentialité doit expliquer
la transmission de l’empreinte devinable et des identifiants publics; retirer
une UI maison ne retire pas cette obligation de transparence.

## Conséquences

D1 reçoit immédiatement une ligne `PENDING` après le premier miss accepté,
puis une ligne `VERIFIED` seulement après le cycle OIDC. Une recherche locale
réussie n’est donc jamais confondue avec une publication fiable. Les clients
suivants réutilisent le résultat validé; les clients concurrents attendent.

Le cache ne représente aucune bibliothèque et ne peut pas restaurer la
progression privée. Les anciennes tables et migrations Collectif restent
versionnées pour rollback mais ne sont plus montées ni écrites. Leur éventuelle
suppression distante est une opération destructive séparément approuvée.
Les sauvegardes nouvellement produites n’embarquent plus d’identité owner; un
champ owner présent dans une ancienne archive est accepté pour compatibilité de
lecture mais ignoré par la composition actuelle lors de la restauration.
