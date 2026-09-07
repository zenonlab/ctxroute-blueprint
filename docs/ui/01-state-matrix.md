# Matrice des états UI

Chaque surface doit rendre les états pertinents sans confondre absence de
données, attente, indisponibilité réseau et erreur récupérable. Le stockage
local reste utilisable lorsque les services optionnels sont indisponibles.

| Surface | Vide | Chargement | Partiel | Hors ligne | Erreur récupérable | Blocage explicite |
| --- | --- | --- | --- | --- | --- | --- |
| Menu d’extension | Cette œuvre affiche un état central; les reprises peuvent rester disponibles | analyse de l’onglet actif, agenda ou préférences annoncée dans le panneau actif | titre actif conservé sans enrichissement distant | cache de reprise et données locales restent consultables | nouvelle tentative limitée à Cette œuvre ou Sorties; Réglages complets reste accessible | état central explicite si `activeTab` ou le port de lecture manque; Réglages complets reste accessible |
| Bibliothèque | état isolé distinguant extension requise et absence de favori compatible | état central illustré sans contrôles inactifs | filtres et œuvres enregistrées visibles, métadonnées manquantes signalées | recherche, filtres et progression restent actifs | état central avec nouvelle tentative ciblée | état central expliquant la reprise de migration |
| Panneau Review | bulle compacte avec Inbox et un seul libellé | état central pendant la lecture locale | contexte local et navigation conservés ; aucune décision sans candidat | état central confirmant la disponibilité locale ; choix dans la cloche | état central avec relecture ciblée | état central demandant de rouvrir la cloche après conflit |
| Agenda | aucune sortie connue pour la période | squelette de groupes temporels | dates estimées séparées des dates confirmées | dernier agenda local daté et consultable | actualiser la période concernée | permission de notification refusée pour un rappel |
| Réglages complets | arbre racine visible, invitation à créer un premier dossier | calcul de l’aperçu annoncé sans masquer l’arbre | règles locales visibles, métadonnées nécessaires absentes | édition et aperçu local restent disponibles | relire la configuration ou recalculer uniquement l’aperçu | organisateur indisponible si le message local ou IndexedDB échoue |
| Workbench local | aucun résultat pour le filtre ou aucun composant découvert | chargement du module de preview sélectionné | preview disponible, fichier source facultatif absent | identique : aucune dépendance réseau nécessaire | recharger la preview isolée | erreur de compilation localisée avec chemin du fichier |
| Site membre | semaine ou bibliothèque locale vide, sans carte synthétique | handshake puis projection concernée | dates estimées et champs locaux absents restent explicités | extension absente ou session expirée, sans projection privée | une reconnexion automatique puis nouvelle tentative explicite | version WebBridge incompatible et mise à jour requise |

## Règles communes

- Un état vide propose une prochaine action réelle et ne ressemble pas à une
  erreur.
- Bibliothèque utilise la présentation centrée de `FeedbackState`, sans fond,
  bordure ou seconde coque. Accueil et Agenda reprennent cette présentation
  isolée quand l’extension est absente. Review reste compacte dans la cloche.
- Un chargement conserve les dimensions principales afin d'éviter les sauts de
  mise en page.
- Le popup conserve son header et sa navigation basse dans tous les états; seul
  le panneau actif change. Ses onglets suivent le modèle clavier tablist et
  nomment leur panneau avec `aria-controls` et `aria-labelledby`.
- La carte « Cette œuvre » reste en 3:2. Les reprises sous-jacentes restent en
  2:3, sont bornées à cinq entrées inachevées et n’empêchent jamais le scroll
  vertical du viewport.
- Le popup n’écrit une progression observée que si un marqueur explicite de
  chapitre ou d’épisode correspond à une seule œuvre locale résolue. Sinon, la
  carte générique et sa dernière URL utile restent disponibles sans mutation.
- Un état partiel nomme la donnée absente et conserve les actions locales sûres.
- Le mode hors ligne ne bloque jamais une lecture ou une mutation dont
  IndexedDB possède déjà toutes les données nécessaires.
- Une erreur récupérable agit sur la plus petite opération concernée et ne
  réinitialise pas la surface entière.
- L’organisateur conserve l’arbre pendant le calcul de l’aperçu. Une action
  d’application ou de restauration n’existe dans la surface que si l’hôte fournit
  son callback réel ; l’application exige en plus un aperçu frais, complet et
  explicitement confirmé. Une modification concurrente rend l’aperçu caduc.
- Le snapshot complet de l’arbre est vérifié dans IndexedDB avant le premier
  déplacement. Restaurer ne recrée ni ne supprime un favori; les nouveaux favoris
  restent en place et les parents disparus sont signalés comme ignorés.
- Sa configuration et son aperçu remplacent toute la surface : aucune bordure,
  ombre ou coque centrée ne doit les faire percevoir comme un dialogue.
- Les paramètres avancés appartiennent au dossier développé, restent opérables au
  clavier et combinent leurs choix par ET ; l’ordre des frères départage les règles.
- Un blocage explique sa cause, les données conservées et l'action nécessaire.
- Une décision Review vérifie la révision lue avant son écriture atomique ; un
  conflit ne remplace jamais silencieusement une décision plus récente.
- Le resolver Review partagé verrouille toutes les décisions pendant l'écriture,
  annonce le succès, puis son propriétaire fournit l'élément suivant de la file.
- Le panneau ouvert par la cloche est l'unique surface Review visible ; il
  présente une correspondance à la fois et son propriétaire fournit la suivante.
- Les flèches de pied parcourent la file sans écrire de décision ; elles sont
  désactivées aux bornes et pendant l'enregistrement d'un choix.
- La recherche globale inspecte au plus 500 identifiants de la bibliothèque et
  retourne au plus 24 œuvres ; elle reste locale et accent-insensible.
- Une Review locale sans candidat affiche son contexte et sa position, mais ni
  saisie manuelle ni action de décision tant qu'un port de résolution n'a pas
  fourni des choix vérifiables.
- Toute date d'agenda affiche son statut officiel, confirmé ou estimé au même
  endroit que la date.
- Le cache public strict hydrate seulement les œuvres déjà présentes dans la
  base privée. Son absence conserve l’Agenda local et n’invente aucune sortie.
- Les notifications globales sont désactivées par défaut. Une activation locale
  programme à l’heure exacte uniquement les sorties officielles ou confirmées;
  le worker reprend les échéances manquées au démarrage et par alarme dédupliquée.
- Les sept jours de l’Agenda restent côte à côte sur mobile dans un rail
  horizontal focusable; ils ne deviennent jamais une pile verticale infinie.
- Le site distingue chargement, extension absente, reconnexion, incompatibilité,
  connexion et erreur récupérable avant d’afficher une projection privée.
- La Bibliothèque web conserve recherche et facette dans l’URL, retire le
  curseur à chaque changement de filtre et demande au plus 24 œuvres.
- L’Agenda web demande une seule période date-only lundi `[from,to)` par
  changement de semaine; les heures et disponibilités viennent du timestamp
  local projeté et ne sont jamais complétées par une fixture.
- Le workbench isole l'échec d'une preview afin que le catalogue et les autres
  composants restent inspectables.
