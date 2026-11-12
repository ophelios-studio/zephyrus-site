---
title: Middleware
order: 5
description: Enveloppez le pipeline de requête avec des middlewares, enregistrez des middlewares globaux et nommés, attachez-les aux routes et écrivez les vôtres.
---

# Middleware

Du code qui enveloppe chaque requête.

Un middleware se place entre l’application et votre contrôleur. Il peut lire ou modifier la requête à l’aller, répondre de lui-même sans appeler le contrôleur, ou modifier la réponse au retour. Les sessions, la protection CSRF et les en-têtes de sécurité sont tous des middlewares.

## L’interface

```php
namespace Zephyrus\Http;

interface MiddlewareInterface
{
    public function process(Request $request, callable $next): Response;
}
```

`$next` exécute le reste du pipeline et retourne sa réponse. Un middleware fait l’une de ces trois choses :

- appelle `$next($request)` et retourne sa réponse, éventuellement décorée ;
- appelle `$next()` avec une requête modifiée (les requêtes sont immuables : utilisez `withAttribute()`) ;
- retourne une réponse sans appeler `$next()`, ce qui arrête la requête à cet endroit.

## Un middleware qui court-circuite

```php
<?php

declare(strict_types=1);

namespace App\Middleware;

use Zephyrus\Http\MiddlewareInterface;
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;

final class RequireUserMiddleware implements MiddlewareInterface
{
    public function process(Request $request, callable $next): Response
    {
        $token = $request->headers()->bearerToken();
        if ($token !== 'secret-token') {
            return Response::json(['error' => 'Sign in first.'], 401);
        }

        return $next($request->withAttribute('userId', 42));
    }
}
```

Sans jeton valide, le contrôleur ne s’exécute jamais. Avec un jeton valide, le contrôleur reçoit `userId` comme attribut de requête : un paramètre de gestionnaire nommé `$userId` est rempli à partir de celui-ci (voir [Paramètres de route](../routing/#paramètres-de-route)). Le jeton écrit en dur ne sert que pour cet exemple : une vraie vérification cherche l’identifiant dans une source (voir [Authentification](../authentication/)).

## Un middleware qui décore la réponse

```php
final class ServerTimingMiddleware implements MiddlewareInterface
{
    public function process(Request $request, callable $next): Response
    {
        $start = hrtime(true);
        $response = $next($request);
        $milliseconds = (hrtime(true) - $start) / 1_000_000;

        return $response->withHeader('Server-Timing', sprintf('app;dur=%.1f', $milliseconds));
    }
}
```

Les réponses sont immuables elles aussi : `withHeader()` retourne une copie, alors retournez-la.

Un objet middleware sert toutes les requêtes du processus. Gardez les données propres à une requête dans la requête (les attributs), jamais dans une propriété.

## Enregistrer des middlewares

Il en existe deux sortes, toutes deux enregistrées sur le constructeur de l’application.

```php
use App\Middleware\RequireUserMiddleware;
use App\Middleware\ServerTimingMiddleware;

$app = ApplicationBuilder::create()
    ->withRouter($router)
    ->withMiddleware(new ServerTimingMiddleware())
    ->registerMiddleware('auth', new RequireUserMiddleware())
    ->build();
```

- **Global**, avec `withMiddleware($middleware)` : s’exécute sur chaque requête, y compris les réponses 404 et 405.
- **Nommé**, avec `registerMiddleware('auth', $middleware)` : ne fait que donner un nom au middleware. Il s’exécute sur les routes qui référencent ce nom.

Le constructeur est immuable. Chaque `with*()` et `registerMiddleware()` retourne un nouveau constructeur, alors chaînez les appels ou réassignez : un appel dont le résultat est perdu ne monte rien.

## Attacher des middlewares nommés aux routes

```php
use Zephyrus\Routing\Attribute\Middleware;
use Zephyrus\Routing\Attribute\Root;

#[Root('/api/projects')]
#[Middleware('auth')]
final class ProjectController extends Controller
{
    // every route in this class goes through "auth"
}
```

`#[Middleware('name')]` fonctionne sur une classe ou une méthode, et une route peut aussi lister des noms dans son argument `middlewares:`. `#[MiddlewareGroup('admin')]` applique un groupe défini avec `$router->middlewareGroup('admin', ['auth', 'audit'])`. Les détails du routage, y compris `#[WithoutMiddleware]` pour ignorer un middleware global sur une route, se trouvent dans [Routage](../routing/#attacher-des-middlewares).

Une route qui désigne un middleware que personne n’a enregistré est refusée à la construction de l’application, avec un message qui liste les noms inconnus, les routes qui les désignent et les noms enregistrés.

## L’ordre

Le premier middleware global ajouté s’exécute à l’extérieur : il voit la requête en premier et la réponse en dernier. Après les middlewares globaux, le middleware propre à la route s’exécute, puis le gestionnaire. Le middleware de route s’exécute d’abord au niveau de la classe (les classes parentes avant les sous-classes), puis les attributs `#[Middleware]` de la méthode, puis ses attributs `#[MiddlewareGroup]`, chaque groupe étant développé dans l’ordre de sa liste.

Avec ces enregistrements :

```php
->withMiddleware(new TraceMiddleware('global1'))
->withMiddleware(new TraceMiddleware('global2'))
->registerMiddleware('a', new TraceMiddleware('a'))
// ... 'b', 'c' and 'd' the same way
```

une classe de contrôleur portant `#[Middleware('a')]`, et une méthode portant `#[MiddlewareGroup('g')]` (un groupe composé de `c` et `d`) et `#[Middleware('b')]`, les appels se produisent dans cet ordre :

```text
global1:in global2:in a:in b:in c:in d:in handler d:out c:out b:out a:out global2:out global1:out
```

Une requête qui ne correspond à aucune route traverse tout de même les middlewares globaux :

```text
global1:in global2:in global2:out global1:out
```

Comme le pipeline enveloppe tout, placez en premier les middlewares qui doivent voir chaque réponse (en-têtes de sécurité, redirection HTTPS). Un middleware qui décore les réponses décore donc aussi les réponses 404, 405 et d’erreur.

Lorsqu’aucune route ne correspond, la requête porte l’attribut `Request::ATTRIBUTE_UNMATCHED_ROUTE` à `true`. Un middleware qui valide une ressource (CSRF, par exemple) peut l’utiliser pour refuser de répondre à propos d’un chemin qui n’existe pas ; un middleware décorateur doit l’ignorer et continuer de s’exécuter.

## Le pipeline lui-même

`Zephyrus\Http\MiddlewarePipeline` est la chaîne immuable que construit l’application. Vous y touchez rarement, mais elle est publique : `pipe($middleware)` et `pipeMany($list)` retournent une copie plus longue, `without([Class::class])` retourne une copie sans les instances des classes ou interfaces données, et `handle($request, $destination)` exécute la chaîne autour d’une fonction de destination. C’est utile pour tester un middleware isolément :

```php
$pipeline = (new MiddlewarePipeline())->pipe(new ServerTimingMiddleware());

$response = $pipeline->handle(
    Request::fromArray('GET', '/'),
    fn (Request $request): Response => Response::text('ok'),
);
```

## Middlewares intégrés

| Middleware | Ce qu’il fait | Documenté dans |
|---|---|---|
| `Session\SessionMiddleware` | Démarre la session et l’expose sur la requête | [Sessions](../sessions/) |
| `Security\CsrfMiddleware` | Refuse les requêtes qui modifient l’état sans jeton CSRF valide | [Sécurité](../security/) |
| `Security\SecureHeadersMiddleware` | Ajoute les en-têtes de sécurité configurés à chaque réponse | [Sécurité](../security/) |
| `Security\ForceHttpsMiddleware` | Redirige les requêtes HTTP simples vers HTTPS avec un 308 | [Sécurité](../security/) |
| `Security\AllowedHostsMiddleware` | Refuse les requêtes dont le `Host` n’est pas dans la liste autorisée | [Sécurité](../security/) |
| `Security\MaxBodySizeMiddleware` | Refuse les corps de requête qui dépassent la limite de taille | [Sécurité](../security/) |
| `Security\AuthGuardMiddleware` | Répond 401 à moins qu’une garde n’accepte la requête | [Authentification](../authentication/) |
| `Security\ContentSecurityPolicyMiddleware` | Envoie un en-tête `Content-Security-Policy`, au besoin avec un nonce propre à la requête | [Content Security Policy](../../digging-deeper/content-security-policy/) |

Les middlewares de sécurité nommés dans votre configuration doivent être montés par l’application : le framework refuse de démarrer lorsqu’un réglage déclaré n’est appliqué par rien. [Sécurité](../security/) présente le câblage complet. Les middlewares de sécurité ne peuvent pas être ignorés avec `#[WithoutMiddleware]`.

Une garde s’enregistre en une ligne :

```php
use Zephyrus\Security\AuthGuardMiddleware;
use Zephyrus\Security\PredicateAuthGuard;

$guard = new AuthGuardMiddleware(new PredicateAuthGuard(
    fn (Request $request): bool => $request->headers()->get('X-Internal') === '1',
));

$builder = $builder->registerMiddleware('internal', $guard);
```

Une route avec `#[Middleware('internal')]` répond alors `401` avec `{"error":"Unauthorized"}` lorsque le prédicat retourne `false`.

## Bon à savoir

- Réassignez le constructeur : `$builder->withMiddleware(...)` seul sur sa ligne ne monte rien.
- Le premier middleware global est le plus externe. L’ordre compte pour les en-têtes, les redirections et tout ce qui doit voir chaque réponse.
- Le middleware global s’exécute sur les réponses 404 et 405. Le middleware de route ne s’exécute que pour une route trouvée.
- Un middleware nommé qu’aucune route ne référence ne s’exécute jamais.
- Enregistrez un nom avant `build()` : une route qui désigne un middleware ou un groupe inconnu arrête le démarrage.
- Les middlewares sont partagés entre les requêtes : aucun état propre à une requête dans les propriétés.
- `#[WithoutMiddleware]` ignore un middleware global sur une route trouvée, jamais sur un 404 ou un 405, et jamais un middleware de sécurité du framework.
