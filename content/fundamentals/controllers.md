---
title: Controllers
order: 4
description: Write controllers with the Controller base class, its response helpers and lifecycle hooks, and receive dependencies through the container.
---

# Controllers

Plain classes, explicit responses.

A controller is a class whose public methods handle requests and return a `Response`. [Routing](../routing/) decides which method answers which URL. Extending `Zephyrus\Controller\Controller` is optional, but it gives you the response helpers and lifecycle hooks below.

## A first controller

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

A handler takes the parameters it needs: a `Request`, and route placeholders by name (`int $id`). See [Route parameters](../routing/#route-parameters) for the resolution rules. A handler must return a `Response`.

A class that does not extend `Controller` works too, provided its handler methods return a `Response`.

## Response helpers

Every helper is a protected method returning a `Response` (see [HTTP](../http/) for the response itself).

| Helper | Response |
|---|---|
| `json(array $payload, int $status = 200)` | JSON body, `application/json` |
| `created(array $payload)` | JSON body with status 201 |
| `respond(array $payload, int $status)` | JSON body with the status you pick |
| `text(string $body, int $status = 200)` | `text/plain` body |
| `noContent()` | 204, empty body |
| `redirect(string $url, int $status = 302)` | redirect to a fixed target |
| `localRedirect(mixed $target, string $fallback = '/', int $status = 302)` | redirect to a target read from the request |
| `abort(int $status, string $body = '')` | HTML response with that status |
| `abortJson(int $status, array $payload)` | JSON response with that status |

`redirect()` is for targets you write. For anything that comes from the request (a `next` query parameter, a form field) use `localRedirect()`: it only follows a local path and sends the visitor to the fallback otherwise.

```php
#[Get('/back')]
public function back(Request $request): Response
{
    return $this->localRedirect($request->query('next'), '/account/');
}
```

`?next=//evil.example` redirects to `/account/`; `?next=/account/settings` redirects to `/account/settings`.

## Validating input

`validate()` runs a `FormValidator` against an array and returns its error bag. When a field fails it throws a `ValidationException`, which the application answers with a 422 unless you handle it (see [Validation](../validation/) and [Errors](../errors/)).

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

## Lifecycle hooks

`Controller` implements `ControllerLifecycleInterface`: `before(Request $request): ?Response` runs before the handler and `after(Request $request, Response $response): Response` runs after it. The interface is the contract; any controller can implement it without extending `Controller`.

The order is `before()`, the handler, `after()`. A `Response` returned by `before()` is sent as is: the handler and `after()` are skipped. An exception thrown by the handler also skips `after()`.

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

The default `before()` stores the request in `$this->request`. An override must call `parent::before($request)` first, or `$this->request` stays unset. Hooks apply to one controller; logic shared by several routes belongs in [middleware](../middleware/), which also sees 404 and 405 answers.

The 401 above skips `after()`, so it carries no `Cache-Control` header. Decorate error responses where you build them, or do it in a middleware.

## Rendering views

A controller that renders templates uses the `RenderResponses` trait, which adds `render()`, `renderWith()` and `html()`:

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

`ApplicationBuilder::withRenderEngine()` hands the engine to every controller that uses the trait. Engines, template lookup and Latte helpers are covered in [Views](../views/).

## Constructor injection

By default a controller is built with no constructor arguments. Pass a container to the builder and its constructor dependencies are resolved for you:

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

The container builds `Clock` automatically when it is a concrete class with resolvable arguments. Register interfaces and shared services with `bind()`, `singleton()` and `instance()`: see [Container and events](../../digging-deeper/container-and-events/). `withControllerFactory(fn (string $class): object => ...)` plugs in any other way of building controllers.

## Good to know

- An override of `before()` must call `parent::before($request)`, or `$this->request` is unset when the handler reads it.
- A `Response` from `before()` skips `after()`; an exception from the handler skips it too.
- Do not register a controller as a container singleton if it keeps per-request state such as `$this->request`: the same instance would serve every request of the process.
- Use `localRedirect()` for any redirect target that comes from the request; `redirect()` trusts its argument.
- `abort()` sends an HTML body and `abortJson()` a JSON one. Pick the one your client expects.
- A missing record is a 404: `return $this->abort(404)`, or throw `RouteNotFoundException` from deeper code (see [Routing](../routing/#404-and-405)).
