---
title: Contrôleurs
order: 4
description: Écrivez des contrôleurs avec la classe de base Controller, ses assistants de réponse et ses points d’entrée de cycle de vie, et recevez vos dépendances par le conteneur.
---

# Contrôleurs

Des classes ordinaires, des réponses explicites.

Un contrôleur est une classe dont les méthodes publiques traitent les requêtes et retournent une `Response`. Le [routage](../routing/) décide quelle méthode répond à quelle URL. Étendre `Zephyrus\Controller\Controller` est facultatif, mais cela vous donne les assistants de réponse et les points d’entrée de cycle de vie ci-dessous.

## Un premier contrôleur

```php
<?php

declare(strict_types=1);

namespace App\Controllers;

use Zephyrus\Controller\Controller;
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Routing\Attribute\Get;
use Zephyrus\Routing\Attribute\Post;
use Zephyrus\Routing\Attribute\Root;

#[Root('/projects')]
final class ProjectController extends Controller
{
    #[Get('/{id}', constraints: ['id' => '\d+'])]
    public function show(int $id): Response
    {
        return $this->json(['id' => $id]);
    }

    #[Post('/')]
    public function store(Request $request): Response
    {
        return $this->created(['name' => $request->body()->get('name')]);
    }
}
```

Un gestionnaire prend les paramètres dont il a besoin : une `Request`, et les paramètres de route par leur nom (`int $id`). Consultez [Paramètres de route](../routing/#paramètres-de-route) pour les règles de résolution. Un gestionnaire doit retourner une `Response`.

Une classe qui n’étend pas `Controller` fonctionne aussi, pourvu que ses méthodes de gestion retournent une `Response`.

## Assistants de réponse

Chaque assistant est une méthode protégée qui retourne une `Response` (voir [HTTP](../http/) pour la réponse elle-même).

| Assistant | Réponse |
|---|---|
| `json(array $payload, int $status = 200)` | Corps JSON, `application/json` |
| `created(array $payload)` | Corps JSON avec le statut 201 |
| `respond(array $payload, int $status)` | Corps JSON avec le statut de votre choix |
| `text(string $body, int $status = 200)` | Corps `text/plain` |
| `noContent()` | 204, corps vide |
| `redirect(string $url, int $status = 302)` | Redirection vers une cible fixe |
| `localRedirect(mixed $target, string $fallback = '/', int $status = 302)` | Redirection vers une cible lue dans la requête |
| `abort(int $status, string $body = '')` | Réponse HTML avec ce statut |
| `abortJson(int $status, array $payload)` | Réponse JSON avec ce statut |

`redirect()` est destiné aux cibles que vous écrivez. Pour tout ce qui provient de la requête (un paramètre de requête `next`, un champ de formulaire), utilisez `localRedirect()` : il ne suit qu’un chemin local et renvoie le visiteur vers la valeur de repli dans le cas contraire.

```php
#[Get('/back')]
public function back(Request $request): Response
{
    return $this->localRedirect($request->query('next'), '/account/');
}
```

`?next=//evil.example` redirige vers `/account/` ; `?next=/account/settings` redirige vers `/account/settings`.

## Valider les entrées

`validate()` exécute un `FormValidator` sur un tableau et retourne son sac d’erreurs. Lorsqu’un champ échoue, il lance une `ValidationException`, à laquelle l’application répond par un 422 à moins que vous ne la traitiez (voir [Validation](../validation/) et [Erreurs](../errors/)).

```php
use Zephyrus\Validation\FormValidator;
use Zephyrus\Validation\Rules;

#[Post('/email')]
public function changeEmail(Request $request): Response
{
    $form = new FormValidator(['email' => [Rules::required(), Rules::email()]]);
    $this->validate($form, $request->body()->all());

    return $this->json(['email' => $request->body()->get('email')]);
}
```

## Points d’entrée de cycle de vie

`Controller` implémente `ControllerLifecycleInterface` : `before(Request $request): ?Response` s’exécute avant le gestionnaire et `after(Request $request, Response $response): Response` s’exécute après. L’interface est le contrat ; tout contrôleur peut l’implémenter sans étendre `Controller`.

L’ordre est `before()`, le gestionnaire, `after()`. Une `Response` retournée par `before()` est envoyée telle quelle : le gestionnaire et `after()` sont ignorés. Une exception lancée par le gestionnaire ignore aussi `after()`.

```php
final class AccountController extends Controller
{
    public function before(Request $request): ?Response
    {
        parent::before($request);

        if ($request->headers()->get('X-Api-Key') !== 'demo-key') {
            return $this->respond(['error' => 'Unauthorized'], 401);
        }

        return null;
    }

    public function after(Request $request, Response $response): Response
    {
        return $response->withHeader('Cache-Control', 'no-store');
    }

    #[Get('/account')]
    public function show(): Response
    {
        return $this->json(['path' => $this->request->path()]);
    }
}
```

Le `before()` par défaut range la requête dans `$this->request`. Une redéfinition doit d’abord appeler `parent::before($request)`, sinon `$this->request` reste non initialisé. Les points d’entrée s’appliquent à un seul contrôleur ; la logique partagée par plusieurs routes relève des [middlewares](../middleware/), qui voient aussi les réponses 404 et 405.

Le 401 ci-dessus ignore `after()`, il ne porte donc aucun en-tête `Cache-Control`. Décorez les réponses d’erreur là où vous les construisez, ou faites-le dans un middleware.

## Rendre des vues

Un contrôleur qui rend des gabarits utilise le trait `RenderResponses`, qui ajoute `render()`, `renderWith()` et `html()` :

```php
use Zephyrus\Rendering\RenderResponses;

final class PageController extends Controller
{
    use RenderResponses;

    #[Get('/pages/{id}', constraints: ['id' => '\d+'])]
    public function show(int $id): Response
    {
        return $this->render('pages/show', ['id' => $id]);
    }
}
```

`ApplicationBuilder::withRenderEngine()` remet le moteur à chaque contrôleur qui utilise le trait. Les moteurs, la recherche de gabarits et les assistants Latte sont traités dans [Vues](../views/).

## Injection par le constructeur

Par défaut, un contrôleur est construit sans argument de constructeur. Passez un conteneur au constructeur de l’application et les dépendances de son constructeur sont résolues pour vous :

```php
use Zephyrus\Container\Container;

$app = ApplicationBuilder::create()
    ->withRouter($router)
    ->withContainer(new Container())
    ->build();
```

```php
final class AccountController extends Controller
{
    public function __construct(private readonly Clock $clock)
    {
    }
}
```

Le conteneur construit `Clock` automatiquement lorsqu’il s’agit d’une classe concrète dont les arguments sont résolvables. Enregistrez les interfaces et les services partagés avec `bind()`, `singleton()` et `instance()` : voir [Conteneur et événements](../../digging-deeper/container-and-events/). `withControllerFactory(fn (string $class): object => ...)` permet de brancher toute autre manière de construire les contrôleurs.

## Bon à savoir

- Une redéfinition de `before()` doit appeler `parent::before($request)`, sinon `$this->request` n’est pas initialisé lorsque le gestionnaire le lit.
- Une `Response` provenant de `before()` ignore `after()` ; une exception du gestionnaire l’ignore aussi.
- N’enregistrez pas un contrôleur comme singleton du conteneur s’il garde un état propre à la requête, comme `$this->request` : la même instance servirait toutes les requêtes du processus.
- Utilisez `localRedirect()` pour toute cible de redirection qui provient de la requête ; `redirect()` fait confiance à son argument.
- `abort()` envoie un corps HTML et `abortJson()` un corps JSON. Choisissez celui qu’attend votre client.
- Un enregistrement manquant est un 404 : `return $this->abort(404)`, ou lancez `RouteNotFoundException` depuis un code plus profond (voir [Routage](../routing/#404-et-405)).
