---
title: Introduction
order: 1
description: Un premier aperçu du guide Zephyrus. Un point de départ clair.
---

# Introduction

Un point de départ clair.

Zephyrus est un framework PHP cohérent qui réunit le routage par attributs, les objets HTTP immuables, la configuration typée et les middlewares de sécurité sur une même fondation.

Ce guide prend forme avec la prochaine mise à jour du framework. Il présente pour l’instant l’expérience de lecture et les sujets qui seront couverts.

## Une fondation réfléchie

L’idée est simple : rendre le parcours d’une application facile à suivre. Garder la route près de son contrôleur, rendre la réponse explicite et placer la configuration à un endroit visible.

> **À propos de cet aperçu**
> Les exemples illustrent les choix du framework. La référence complète et les instructions de démarrage suivront la mise à jour du core.

## Les composants du core

Le guide suit les étapes d’une requête, de son point d’entrée à sa réponse.

| Sujet | Ce que nous explorerons |
| --- | --- |
| [Routage](/fr/fundamentals/routing/) | Attributs, contrôleurs et paramètres typés |
| [HTTP](/fr/fundamentals/http/) | Requêtes, réponses et immutabilité |
| [Configuration](/fr/fundamentals/configuration/) | YAML, environnement et sections typées |
| [Localisation](/fr/fundamentals/localization/) | Catalogues JSON, paramètres et replis de langue |
| [Données](/fr/fundamentals/data/) | SQL explicite, Brokers et Entity |
| [Sécurité](/fr/fundamentals/security/) | Middlewares et validation des entrées |

## Un premier exemple

Une route déclare son chemin directement sur la méthode qui la traite. Cet exemple illustratif retourne une réponse JSON.

```php
use Zephyrus\Http\Response;
use Zephyrus\Routing\Attribute\Get;

#[Get('/hello')]
public function hello(): Response
{
    return Response::json(['message' => 'Bonjour !']);
}
```

L’URL, la méthode et la réponse sont visibles ensemble. Le chapitre sur le routage détaillera les conventions après la mise à jour.

## Parcourir le guide

Les chapitres à gauche permettent d’explorer un sujet. Le sommaire à droite suit la page courante. Recherchez dans le guide avec `⌘ K` sur macOS ou `Ctrl K` ailleurs.

La prochaine étape est [Structure du projet](/fr/getting-started/project-structure/), un aperçu de l’organisation d’une application Zephyrus.
