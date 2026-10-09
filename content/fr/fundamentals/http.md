---
title: HTTP
order: 2
description: Un aperçu des requêtes et des réponses dans le guide Zephyrus.
---

# HTTP

Chaque réponse, explicite.

Les objets de requête et de réponse sont au cœur de Zephyrus. Ce chapitre expliquera leur structure et la façon dont l’immutabilité organise le parcours d’une application.

## Des changements intentionnels

Une réponse peut être créée avec un statut explicite. Modifier un en-tête retourne un nouvel objet de réponse.

```php
use Zephyrus\Http\Response;

$response = Response::json(['created' => true], 201);
$response = $response->withHeader('Cache-Control', 'no-store');

return $response;
```

## Ce que ce chapitre couvrira

- L’objet de requête et ses composants typés
- Les réponses JSON, HTML et de redirection
- Les en-têtes, les statuts et l’immutabilité
- Le cycle de réponse et les flux SSE

> **Référence en préparation**
> Cet exemple est illustratif. L’API complète sera documentée avec le core mis à jour.
