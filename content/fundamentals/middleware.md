---
title: Middleware
order: 5
description: Wrap the request pipeline with middleware, register global and named middleware, attach it to routes, and write your own.
---

# Middleware

Code that wraps every request.

A middleware sits between the application and your controller. It can read or change the request on the way in, answer on its own without calling the controller, or change the response on the way out. Sessions, CSRF protection and security headers are all middleware.

## The interface

```php
namespace Zephyrus\Http;

interface MiddlewareInterface
{
    public function process(Request $request, callable $next): Response;
}
```

`$next` runs the rest of the pipeline and returns its response. A middleware does one of three things:

- calls `$next($request)` and returns its response, possibly decorated;
- calls `$next()` with a changed request (requests are immutable: use `withAttribute()`);
- returns a response without calling `$next()`, which stops the request there.

## A middleware that short-circuits

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

Without a valid token the controller never runs. With one, the controller receives `userId` as a request attribute: a handler parameter named `$userId` is filled from it (see [Route parameters](../routing/#route-parameters)). The hard-coded token is only for this example: a real check looks the credential up (see [Authentication](../authentication/)).

## A middleware that decorates the response

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

Responses are immutable too: `withHeader()` returns a copy, so return it.

A middleware object serves every request of the process. Keep per-request data in the request (attributes), never in a property.

## Registering middleware

There are two kinds, both registered on the application builder.

```php
use App\Middleware\RequireUserMiddleware;
use App\Middleware\ServerTimingMiddleware;

$app = ApplicationBuilder::create()
    ->withRouter($router)
    ->withMiddleware(new ServerTimingMiddleware())
    ->registerMiddleware('auth', new RequireUserMiddleware())
    ->build();
```

- **Global**, with `withMiddleware($middleware)`: runs on every request, including 404 and 405 answers.
- **Named**, with `registerMiddleware('auth', $middleware)`: only gives the middleware a name. It runs on the routes that reference that name.

The builder is immutable. Every `with*()` and `registerMiddleware()` returns a new builder, so chain the calls or reassign: a call whose result is dropped mounts nothing.

## Attaching named middleware to routes

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

`#[Middleware('name')]` works on a class or a method, and a route can also list names in its `middlewares:` argument. `#[MiddlewareGroup('admin')]` applies a group defined with `$router->middlewareGroup('admin', ['auth', 'audit'])`. Routing details, including `#[WithoutMiddleware]` to skip a global middleware on one route, are in [Routing](../routing/#attaching-middleware).

A route that names a middleware nobody registered is refused when the application is built, with a message listing the unknown names, the routes naming them and the names that are registered.

## The order

The first global middleware you add runs outermost: it sees the request first and the response last. After the globals, the route's own middleware runs, then the handler. Route middleware runs class-level first (parent classes before subclasses), then the method's `#[Middleware]` attributes, then its `#[MiddlewareGroup]` attributes, each group expanded in the order of its list.

With these registrations:

```php
->withMiddleware(new TraceMiddleware('global1'))
->withMiddleware(new TraceMiddleware('global2'))
->registerMiddleware('a', new TraceMiddleware('a'))
// ... 'b', 'c' and 'd' the same way
```

a controller class carrying `#[Middleware('a')]`, and a method carrying `#[MiddlewareGroup('g')]` (a group of `c` and `d`) and `#[Middleware('b')]`, the calls happen in this order:

```text
global1:in global2:in a:in b:in c:in d:in handler d:out c:out b:out a:out global2:out global1:out
```

A request that matches no route still goes through the globals:

```text
global1:in global2:in global2:out global1:out
```

Because the pipeline wraps everything, put the middleware that must see every response (security headers, HTTPS redirect) first. A middleware that decorates responses is therefore also decorating 404, 405 and error answers.

When no route matched, the request carries the attribute `Request::ATTRIBUTE_UNMATCHED_ROUTE` set to `true`. A middleware that validates a resource (CSRF, for example) can use it to decline to answer for a path that does not exist; a decorating middleware should ignore it and keep running.

## The pipeline itself

`Zephyrus\Http\MiddlewarePipeline` is the immutable chain the application builds. You rarely touch it, but it is public: `pipe($middleware)` and `pipeMany($list)` return a longer copy, `without([Class::class])` returns a copy without the instances of the given classes or interfaces, and `handle($request, $destination)` runs the chain around a destination callable. It is useful to test a middleware in isolation:

```php
$pipeline = (new MiddlewarePipeline())->pipe(new ServerTimingMiddleware());

$response = $pipeline->handle(
    Request::fromArray('GET', '/'),
    fn (Request $request): Response => Response::text('ok'),
);
```

## Built-in middleware

| Middleware | What it does | Documented in |
|---|---|---|
| `Session\SessionMiddleware` | Starts the session and exposes it on the request | [Sessions](../sessions/) |
| `Security\CsrfMiddleware` | Refuses state-changing requests without a valid CSRF token | [Security](../security/) |
| `Security\SecureHeadersMiddleware` | Adds the configured security headers to every response | [Security](../security/) |
| `Security\ForceHttpsMiddleware` | Redirects plain HTTP requests to HTTPS with a 308 | [Security](../security/) |
| `Security\AllowedHostsMiddleware` | Refuses requests whose `Host` is not in the allowlist | [Security](../security/) |
| `Security\MaxBodySizeMiddleware` | Refuses request bodies over the size limit | [Security](../security/) |
| `Security\AuthGuardMiddleware` | Answers 401 unless a guard accepts the request | [Authentication](../authentication/) |
| `Security\ContentSecurityPolicyMiddleware` | Sends a `Content-Security-Policy` header, optionally with a per-request nonce | [Content Security Policy](../../digging-deeper/content-security-policy/) |

The security middleware named in your configuration must be mounted by the application: the framework refuses to boot a declared setting that nothing enforces. [Security](../security/) shows the full wiring. The security middleware cannot be skipped with `#[WithoutMiddleware]`.

A guard is one line to register:

```php
use Zephyrus\Security\AuthGuardMiddleware;
use Zephyrus\Security\PredicateAuthGuard;

$guard = new AuthGuardMiddleware(new PredicateAuthGuard(
    fn (Request $request): bool => $request->headers()->get('X-Internal') === '1',
));

$builder = $builder->registerMiddleware('internal', $guard);
```

A route with `#[Middleware('internal')]` then answers `401` with `{"error":"Unauthorized"}` when the predicate returns `false`.

## Good to know

- Reassign the builder: `$builder->withMiddleware(...)` on its own line mounts nothing.
- The first global middleware is the outermost. Order matters for headers, redirects and anything that must see every response.
- Global middleware runs on 404 and 405 answers. Route middleware runs only for a matched route.
- A named middleware that no route references never runs.
- Register a name before `build()`: a route naming an unknown middleware or group stops the boot.
- Middleware is shared across requests: no per-request state in properties.
- `#[WithoutMiddleware]` skips a global middleware on a matched route, never on a 404 or 405, and never a framework security middleware.
