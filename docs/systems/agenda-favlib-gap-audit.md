# Audit Agenda FavLib → TobiRink

## Verdict

L'Agenda TobiRink actuel est une projection locale sans alimentation. La
route publique déployée répond avec `entries: []` et l'extension ne l'appelle
pas : elle lit seulement `tobirink.public-releases.v1` dans `storage.local`.
La comparaison FavLib confirme qu'il manque la collecte publique, la cache
atomique, la jointure par identifiant, les prédictions, la reprise MV3 et les
tests installés.

## Ce qui est déjà correct

- IndexedDB reste l'autorité privée des Works, progressions, rappels et tâches.
- Le site passe par WebBridge et ne possède pas de binding D1.
- Le Worker possède les bindings Cloudflare et les requêtes D1 existantes sont
  préparées et bornées.
- Le snapshot R2 v1 est strict, versionné et conserve un pointeur précédent.
- Les rappels estimés sont déjà exclus du planificateur natif.
- `storage.sync` est réservé au snapshot d'identifiants fournisseurs.

## Écarts bloquants

1. Aucun producteur AniList `airingSchedule` ni MangaUpdates n'existe.
2. Aucun cron ne lance la collecte quotidienne.
3. Le snapshot vide est présenté comme une fonctionnalité terminée.
4. Aucun endpoint paginé v2 n'existe.
5. L'extension ne possède aucun adaptateur HTTP de calendrier.
6. Le cache est dans `storage.local`, hors de l'autorité transactionnelle
   IndexedDB.
7. Il n'y a ni TTL de 24 heures, ni ETag, ni `304`, ni pagination complète.
8. Une page incomplète ne peut pas être rejetée atomiquement.
9. Une panne ne conserve pas explicitement une dernière génération valide.
10. Les événements publics ne séparent pas `DATE` et `INSTANT`.
11. Le modèle ne porte pas release kind, provenance, version et expiration.
12. Il n'existe pas de `LocalReleaseEvidence` distincte de `AgendaEntry`.
13. La projection actuelle dépend d'œuvres présentes mais sans index provider.
14. Aucun historique de sorties MangaUpdates n'est conservé.
15. Aucune estimation bornée par médiane n'est calculée.
16. Aucun remplacement officiel-vers-estimé n'est défini.
17. Les états terminé, annulé et en pause ne sont pas pilotés par le cycle de
    vie Agenda.
18. Les alarmes actuelles sont génériques et ne restaurent pas un calendrier.
19. La reprise après suspension MV3 et après crash n'est pas démontrée.
20. La notification n'a pas de contrat séparé de livraison revendiquée.
21. L'UX ne distingue pas cache ancien, synchronisation partielle, vide réel
    et panne récupérable.
22. Le bouton de reprise ne déclenche pas de récupération réseau.
23. `DATE`/`INSTANT` ne sont pas exportés correctement vers ICS.
24. La reconstruction après reset ne recharge pas le calendrier commun.
25. Les tests utilisent des fixtures injectées et ne prouvent pas une Agenda
    non vide dans une extension installée.

## Référence FavLib retenue

FavLib ADR 0088 est l'oracle comportemental pour la fenêtre commune J−1/J+15,
les pages complètes, ETag, commit atomique, dernier snapshot valide, jointure
par IDs, historique MangaUpdates, prédiction bornée, alarmes stables et
notifications revendiquées. Le contrat TobiRink prévaut partout où FavLib
contredit la confidentialité ou le rôle de `storage.sync`.

La base FavLib privée n'est pas copiée, exportée, journalisée ou utilisée dans
les tests. Les validations utiliseront des fixtures anonymisées et
synthétiques.
