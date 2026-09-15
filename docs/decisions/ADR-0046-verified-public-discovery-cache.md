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
  - docs/architecture/src/public-discovery.dataflow.json
  - docs/architecture/src/tobirink.architecture.json
review: on-change
revised: true
---

# ADR-0046 — Cache public de découverte vérifié sans propriétaire

- Status: accepted
- Date: 2026-09-14
- Revised: 2026-09-14
- Supersedes: le protocole Collectif, les owners et les confirmations humaines de l’ADR-0043; l’identité collective de l’ADR-0044

## Contexte

Un cache D1 ne réduit les recherches que s’il est alimenté. La première
version accordait un bail court à une extension afin qu’elle recherche les
fournisseurs et propose des identifiants. Elle empêchait les recherches
textuelles concurrentes, mais conservait les APIs fournisseurs, leurs
permissions et l’hydratation exacte dans l’extension. Elle ne réalisait donc
pas la frontière D1-first attendue.

Le besoin est de réutiliser une œuvre déjà résolue sans envoyer l’URL, le
dossier, la progression ou une bibliothèque. L’extension doit seulement lire
D1 ou y matérialiser une requête publique bornée. La recherche, la sélection et
l’hydratation appartiennent à un composant serveur extractible exécuté par
GitHub Actions. Un résultat fonctionnel, y compris introuvable ou ambigu, doit
être persistant afin que la même requête ne relance pas les fournisseurs.

## Décision

Le protocole public v3 utilise une clé versionnée composée de l’empreinte
SHA-256 du titre canonique local, du type média, de la version du parseur et de
la version des règles. La demande contient aussi au plus quatre titres de
découverte nettoyés et bornés, plus les marqueurs publics nécessaires au
matching : média, saison, format OVA et prépublication. Ces titres et leur
empreinte sont devinables et ne sont pas présentés comme anonymes. Le Worker et
D1 ne leur associent aucun owner, installation, compte, URL, dossier,
progression ou bibliothèque. Les logs applicatifs n’enregistrent ni clé ni
contenu de demande.

Une lecture renvoie exactement un état :

- `MISS` : aucune association ni demande active;
- `PENDING` : une demande bornée existe ou attend une reprise transitoire;
- `UNAVAILABLE` : les huit tentatives serveur sont épuisées et une reprise explicite est requise;
- `VERIFIED` : le composant autorisé a publié un profil fournisseur complet;
- `NOT_FOUND` : toutes les lanes applicables ont répondu sans correspondance;
- `AMBIGUOUS` : plusieurs identités restent crédibles et sont conservées pour
  une Review locale sans nouvelle recherche fournisseur.

Sur `MISS`, le Worker crée atomiquement la demande v3 ou retourne la ligne
concurrente déjà créée. L’extension ne reçoit aucun bail, ne propose aucun
identifiant et n’appelle aucun fournisseur. Une seconde soumission de la même
clé doit porter le même digest de requête; un contenu différent est refusé au
lieu d’écraser le travail existant.

Le composant portable de l’ADR-0047 lit les demandes v3 en attente via une source
injectée. Il route la recherche vers AniList, MangaUpdates, MangaDex, Kitsu
Anime ou Kitsu Manga selon le type média, applique le matcher versionné, puis
hydrate l’identifiant exact retenu. Il produit exactement un résultat
`VERIFIED`, `NOT_FOUND` ou `AMBIGUOUS`; une panne, un 403, un 429, une réponse
incomplète ou un timeout reste `PENDING` avec une reprise bornée. Le Worker
vérifie signature, issuer, audience, dépôt, branche, workflow et digest avant
toute publication; il demeure l’unique auteur des tables publiques fiables.

La clé D1 possède un index unique. Demande, prise de travail et publication sont
idempotentes. Un seul collecteur peut posséder un bail de traitement actif; les
lectures voient `PENDING` et n’appellent aucun fournisseur. Un résultat rejoué
avec le même digest ne change rien. Le collecteur checkpoint son étape avant
chaque reprise; un résultat terminal ne redevient jamais une demande. Une panne
entre un appel fournisseur et son checkpoint peut encore répéter cet appel :
aucun protocole distribué ne peut garantir exactement-une-fois face à ce crash,
mais la répétition concurrente et toute répétition après résultat terminal sont
interdites.

Une huitième tentative dont le bail expire passe en état D1 interne `FAILED` et
la lecture publique renvoie `UNAVAILABLE`. Aucun polling de l’extension ne
réarme cette demande. Un nouveau POST explicite, portant exactement le même
digest, remet la ligne à `PENDING` avec un compteur réinitialisé; tout contenu
différent reste un conflit.

Chaque écriture du catalogue et l’écriture terminale sont conditionnées dans le
même batch D1 par le bail non expiré, son token, le digest de demande et
l’absence de conflit de référence fournisseur. L’adaptateur n’accepte la
publication que si `meta.changes` vaut exactement `1` pour l’UPDATE terminal.

L’extension consulte d’abord IndexedDB, puis `storage.sync`, puis D1. Un
`VERIFIED` fournit directement le candidat hydraté complet utilisé pour écrire
le Work local. `PENDING` programme une relecture sans fournisseur. `NOT_FOUND`
et `AMBIGUOUS` terminent la tâche en Review locale sans relancer le composant.
Quand Public Discovery est configuré, le chemin automatique de découverte et
la réparation automatique de couvertures ne consultent aucun adaptateur de
recherche ou d'hydratation fournisseur. Le background conserve des adaptateurs
distincts uniquement pour le repli Agenda public et pour les actions manuelles
qui affichent explicitement leur effet réseau; leur présence au composition
root ne les autorise jamais comme repli implicite d'un état D1.

Le protocole ne possède aucun réglage Collectif, appairage ou consentement
produit spécifique. La permission navigateur native `bookmarks` et la
déclaration de collecte exigée par les boutiques restent exactes tant que
l’extension lit les favoris. La politique de confidentialité doit expliquer
la transmission de l’empreinte devinable et des identifiants publics; retirer
une UI maison ne retire pas cette obligation de transparence.

## Conséquences

D1 reçoit immédiatement une ligne `PENDING` après le premier miss accepté,
puis un résultat terminal seulement après le cycle OIDC. Les lectures suivantes
réutilisent ce résultat; les requêtes concurrentes attendent. Aucune extension
ne contacte AniList, MangaUpdates, MangaDex ou Kitsu pour cette découverte.

Les anciennes routes `/v2/catalogue/discoveries` et leurs sous-routes sont
retirées et répondent `410 Gone`. L’ingestion, la lecture et la création de
demande utilisent exclusivement v3; aucune identité OIDC privée v2 n’est
conservée.

Le cache ne représente aucune bibliothèque et ne peut pas restaurer la
progression privée. Les anciennes tables et migrations Collectif restent
versionnées pour rollback mais ne sont plus montées ni écrites. Leur éventuelle
suppression distante est une opération destructive séparément approuvée.
Les sauvegardes nouvellement produites n’embarquent plus d’identité owner; un
champ owner présent dans une ancienne archive est accepté pour compatibilité de
lecture mais ignoré par la composition actuelle lors de la restauration.
