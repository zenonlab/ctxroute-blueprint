# Audit sauvegardes, API et extension

Le bootstrap de la pipeline est rejouable sur une base neuve. La restauration doit vérifier la version de schéma, les politiques par fournisseur et finalité, les contraintes, les assets, les jobs et l’isolation utilisateur.

L’API expose métadonnées, thèmes, provenance et URLs privées d’images. Alice et Bob peuvent partager une œuvre ; un tiers sans favori reçoit `404`. L’extension doit être réappairée puis resynchronisée après un reset.
