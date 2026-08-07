# Préparation du démarrage

Créer les secrets, arrêter les services, sauvegarder puis confirmer le reset si la base est jetable. Exécuter le service `migrate`, vérifier les politiques AniList et MangaUpdates par finalité, rebuild API/Worker/Web/extension avec une version commune, redémarrer, réappairer l’extension et synchroniser tous les favoris.

Les fournisseurs sont activés à la demande uniquement, selon la matrice de responsabilités de l’ADR 0021. Les diagnostics sont en lecture seule et ne les contactent jamais. Une clé MangaUpdates absente bloque seulement le flux authentifié des releases et doit être signalée explicitement.
