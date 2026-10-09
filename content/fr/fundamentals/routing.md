---
title: Routage
order: 1
description: Un aperçu du routage par attributs dans le guide Zephyrus.
---

# Routage

Un chemin direct vers votre logique.

Zephyrus déclare les routes avec des attributs PHP sur les méthodes des contrôleurs. Ce chapitre accueillera la référence du routage mis à jour.

## Les routes, en clair

Cet exemple visuel montre un paramètre d’URL et la méthode typée qui le reçoit.

```php
use Zephyrus\Http\Response;
use Zephyrus\Routing\Attribute\Get;

#[Get('/products/{id}')]
public function show(int $id): Response
{
    return Response::json(['id' => $id]);
}
```

## Ce que ce chapitre couvrira

- Attributs de méthodes HTTP et découverte des contrôleurs
- Paramètres d’URL et conversion de types
- Préfixes de routes et middlewares nommés
- Routes conditionnelles avec `RequiresEnv`

> **Référence en préparation**
> Les signatures, les contraintes et les instructions seront finalisées avec la mise à jour du core.

Continuez vers [HTTP](/fr/fundamentals/http/) pour découvrir l’aperçu des requêtes et des réponses.
