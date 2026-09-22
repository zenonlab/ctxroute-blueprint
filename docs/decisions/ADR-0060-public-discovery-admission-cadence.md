---
scope:
  - packages/adapters-browser/src/catalogue/http-public-discovery-adapter.ts
  - packages/adapters-browser/src/catalogue/http-public-discovery-adapter.test.ts
  - apps/worker/wrangler.jsonc
  - apps/extension/scripts/installed-review.mjs
  - docs/architecture/src/real-favorite-resolution.dataflow.json
review: on-change
revised: true
---

# ADR-0060 — Cadencer l’admission Discovery sans fabriquer un backlog de retries

- Status: accepted
- Date: 2026-09-22

## Contexte

L’import réel de 1 522 favoris a montré que le client d’extension réservait
une admission D1 toutes les 6,5 secondes. Cette horloge était globale au
profil et les workers concurrents recevaient immédiatement `ADMISSION_WAIT`.
Ces attentes étaient persistées comme `RETRYABLE`, donnant l’impression d’un
échec fournisseur avant que la Queue publique ait pu traiter les demandes.

## Décision

L’admission d’une demande Discovery est cadencée à 1,1 seconde côté navigateur,
alors que la limite publique est de 60 soumissions par minute et par IP.
Les admissions concurrentes attendent leur créneau lorsqu’il est proche,
jusqu’à une seconde; une attente plus longue reste un `ADMISSION_WAIT` durable
et réessayable. Les refresh manuels ne bloquent jamais l’appel interactif et
échouent immédiatement avec `ADMISSION_WAIT` si le créneau est occupé.

Cette marge limite les écritures d’admission sans limiter les appels
fournisseur : la Queue et le disjoncteur D1 restent les autorités de débit
provider. Aucun `FAILED` historique n’est réarmé par le client. Le harnais
Playwright réel conserve une assertion sur le nombre de Reviews produites et
reste hors ligne par défaut; le mode en ligne est réservé à une mesure
explicite dans un profil temporaire.

## Conséquences

Un import important progresse en file asynchrone au lieu de convertir la
majorité du lot en refus immédiats. Les compteurs `ADMISSION_WAIT` restent
observables et récupérables, tandis qu’une cadence distante ou un circuit
provider reste diagnostiqué séparément. Une reprise de production des lignes
`FAILED` demeure une opération protégée distincte.
