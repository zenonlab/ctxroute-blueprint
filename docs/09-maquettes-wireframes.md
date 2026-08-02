# Wireframes Wave 0

Ces wireframes fixent la structure et les états à tester avant le look final shadcn/ui.

## Accueil / inbox

```text
┌ FavLib ────────────────┬─────────────────────────────────────────┐
│ Accueil                │ Bonjour Alice              [Compte ▾]  │
│ Bibliothèque           ├─────────────────────────────────────────┤
│ Calendrier             │ 3 nouveautés                           │
│ À vérifier (2)         │ ┌ Orbital Knights ─ Épisode 12 ─────┐ │
│ Sources                │ │ Source · FR · détecté il y a 2 h   │ │
│ Réglages               │ │ Position observée 11   [Ouvrir]    │ │
│                        │ └─────────────────────────────────────┘ │
│ Admin                  │ Reprendre                               │
│ Utilisateurs           │ [Paper Moon Hero · chapitre 12.5]      │
│ Santé                  │                                         │
└────────────────────────┴─────────────────────────────────────────┘
```

États : aucune nouveauté, source secondaire, langue différente, source cassée, hors ligne et données obsolètes.

## Bibliothèque

```text
┌ Bibliothèque ────────────────────────────────────────────────────┐
│ [Recherche…] [Anime/Manga ▾] [Statut ▾] [Source ▾] [Grille ≡] │
│                                                                  │
│ ┌ Affiche ┐  ┌ Affiche ┐  ┌ Affiche ┐                           │
│ │         │  │   NEW   │  │         │                           │
│ └─────────┘  └─────────┘  └─────────┘                           │
│ Orbital      Paper Moon   Œuvre sans AniList                    │
│ 11 / 12      12 / 12.5    progression inconnue                  │
└──────────────────────────────────────────────────────────────────┘
```

États : affiche manquante, titre long, nombreuses œuvres, filtre vide et matching absent.

## Fiche œuvre précise

```text
┌ Orbital Knights ─────────────────────────────────────────────────┐
│ [Affiche]  Anime · Saison 1 · En cours             [Ouvrir ▾]   │
│            Position observée : épisode 11                        │
│            Disponible : épisode 12 · 1 nouveauté                  │
├ Favoris associés ────────────────────────────────────────────────┤
│ Chrome bureau · épisode 11 · observé aujourd'hui                 │
├ Sources ─────────────────────────────────────────────────────────┤
│ fixture-anime · FR · sain · vérifié il y a 2 h                  │
├ Sorties ─────────────────────────────────────────────────────────┤
│ 12  Nouveau     fixture-anime · Sources (2)         [Ouvrir ▾]  │
│ 11  Observé     fixture-anime                       [Ouvrir]      │
│ SP-3 Spécial    hors séquence principale            [Ouvrir]      │
└──────────────────────────────────────────────────────────────────┘
```

La disponibilité, la progression observée et la confirmation future doivent rester visuellement distinctes.

### Menu de sources

```text
┌ Sources pour épisode 12 ──────────────────────────────┐
│ ★ Site favori · FR · sain · vérifié il y a 2 h       │
│   Site officiel · EN · sain · vérifié il y a 1 h     │
│   Alternative · FR · obsolète · vérifié hier         │
│                                                       │
│ Fallback automatique : autorisé                       │
└───────────────────────────────────────────────────────┘
```

Le choix ponctuel d'une ligne ne change pas l'étoile. Une migration de domaine est présentée séparément avec sa preuve.

Une sortie seulement annoncée apparaît dans le calendrier avec `Planifié` et sans bouton de lecture. Le bouton `Ouvrir` apparaît après validation d'au moins une origine.

### Découverte de sources

```text
┌ Trouver d'autres sources ───────────────────────────────────────┐
│ Recherche terminée · 4 domaines · budget 6/6                  │
├────────────────────────────────────────────────────────────────┤
│ Vérifié   fixture-anime-alt · EN · public   [Voir] [Épingler] │
│ À vérifier fixture-ambiguous · titre proche       [Examiner]  │
│ Connecteur requis fixture-official                [Détails]   │
│ Rejeté     œuvre de 1998 · année incompatible                 │
└────────────────────────────────────────────────────────────────┘
```

`Épingler` explique que la cible sera surveillée tant que l'œuvre possède un favori actif. `Voir` ouvre ponctuellement sans créer d'abonnement. Chaque résultat permet d'afficher les preuves et raisons.

## Tri des candidats

```text
┌ À vérifier ──────────────────────────────────────────────────────┐
│ Favori : « Hero Episode 12 » · fixture-anime.test               │
│                                                                  │
│ Proposition 1  Orbital Knights     score élevé                  │
│ Raisons : titre alternatif, type anime, épisode plausible        │
│ [Confirmer] [Autre proposition] [Ignorer]                        │
└──────────────────────────────────────────────────────────────────┘
```

Confirmer ici résout une ambiguïté de tri ; ce n'est pas un ajout manuel d'œuvre hors favoris.

## Extension sur page précise

```text
┌ FavLib extension ─────────────────────────────┐
│ ● Connectée comme Alice                      │
│ Orbital Knights · épisode 12                 │
│ Œuvre favorite reconnue                      │
│ Progression contextuelle : activée           │
│ Observation envoyée · épisode 12             │
│ Disponible : 12 · Aucun retard               │
│ [Voir dans FavLib]                            │
└───────────────────────────────────────────────┘
```

États : serveur inaccessible, certificat refusé, appareil révoqué, domaine non autorisé, page non favorite et parseur incertain.

## Administration

```text
┌ Utilisateurs ────────────────────────────────────────────────────┐
│ Alice · membre · 2 appareils · dernière sync 10:42  [Gérer]    │
│ Bob   · membre · 1 appareil  · dernière sync hier   [Gérer]    │
│ [+ Inviter]                                                       │
├ Santé ───────────────────────────────────────────────────────────┤
│ Worker sain · 0 job bloqué · DB 120 MB                          │
│ fixture-anime v1 · 100 % succès                                  │
├ Sauvegardes ─────────────────────────────────────────────────────┤
│ 02 août · HEALTHY · restore 41 s · RPO/RTO mesurés  [Rapport]   │
│ 01 août · FAILED · checksum invalide · dernière saine conservée  │
├ Sécurité ────────────────────────────────────────────────────────┤
│ 2 sessions révoquées · 0 invitation ouverte · journal 90 jours  │
└──────────────────────────────────────────────────────────────────┘
```

`HEALTHY` exige checksum, déchiffrement et restauration sur base neuve. Les objectifs restent `NOT_VERIFIED` avant le premier essai réel. L'administration n'affiche jamais les URLs personnelles des favoris. Le contrôle de la machine hôte reste néanmoins une autorité de confiance documentée.

## Compte et données

```text
┌ Mon compte ──────────────────────────────────────────────────────┐
│ Sessions : cet appareil · autre session [Révoquer]              │
│ Extension : Chrome bureau · dernière sync 10:42 [Révoquer]      │
├ Mes données ─────────────────────────────────────────────────────┤
│ [Créer un export]  JSON versionné · lien valable 24 h           │
│ [Supprimer mon compte]  Réauthentification et confirmation       │
└──────────────────────────────────────────────────────────────────┘
```

La suppression affiche les données concernées, l'effet différé des anciennes sauvegardes chiffrées et la protection contre la résurrection par tombstone. Le dernier administrateur doit d'abord désigner un successeur.
