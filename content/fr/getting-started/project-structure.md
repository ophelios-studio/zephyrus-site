---
title: Structure du projet
order: 2
description: Un aperçu du chapitre sur la structure d’une application Zephyrus.
---

# Structure du projet

Une place pour chaque composant.

Ce chapitre présentera le modèle d’application après la mise à jour du framework. L’organisation ci-dessous sert d’aperçu visuel pour le guide.

## L’application en un regard

Les contrôleurs, les vues et la configuration ont chacun leur place. Le guide final parcourra le modèle d’application et expliquera où votre propre code s’intègre.

```text
app/
  Controllers/     Routes et traitement des requêtes
  Models/          Logique de votre application
  Views/           Templates Latte
public/            Point d’entrée web et ressources
config.yml         Configuration applicative
```

> **Chapitre en préparation**
> L’arborescence finale et les commandes seront vérifiées avec le modèle d’application mis à jour.

## Le parcours d’une requête

1. Une requête entre dans l’application.
2. Le routeur trouve la méthode de contrôleur correspondante.
3. Les middlewares gèrent les étapes qui s’appliquent.
4. Le contrôleur retourne une réponse.

Le chapitre [Routage](/fr/fundamentals/routing/) précisera comment une URL rejoint votre code.
