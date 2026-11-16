---
title: Routing
order: 3
description: Declare routes with attributes on controller methods, constrain parameters, attach middleware, generate URLs and cache the route table.
---

# Routing

A direct path to your logic.

Zephyrus declares routes with PHP attributes on controller methods, and a `Router` collects them. The router is immutable: every method returns a new router, so keep the value you get back. On PHP 8.5 and later, PHP warns when the result of a `with*()` method is dropped, such as `$router->withTrailingSlashTolerance();` alone (`#[\NoDiscard]`); `get()`, `post()` and `discoverControllers()` do not warn, so check those yourself.

## Your first route

```php
<?php

declare(strict_types=1);

namespace App\Controllers;

use Zephyrus\Controller\Controller;
use Zephyrus\Http\Response;
use Zephyrus\Routing\Attribute\Get;

final class StatusController extends Controller
{
    #[Get('/status')]
    public function status(): Response
    {
        return $this->json(['ok' => true]);
    }
}
```

`$root` is the application's base directory, passed in by the bootstrap shown in the [application](../application/) page. The snippets below build `$router` from it.

Tell the router where your controllers live:

```php
use Zephyrus\Routing\Router;

$router = (new Router())->discoverControllers('App\\Controllers', $root . '/app/Controllers');
```

`discoverControllers()` walks the directory, loads every concrete class whose name matches the namespace and registers the routes it declares. The router is then handed to the application builder with `withRouter($router)` (see [Application](../application/)). With a `router:` section in `config.yml` you write none of this: see [The router section](#the-router-section).

## Method attributes

Each HTTP method has an attribute in `Zephyrus\Routing\Attribute`: `Get`, `Post`, `Put`, `Patch`, `Delete`, `Head` and `Options`. They all take a path, then optional `constraints`, `middlewares` and `name`.

```php
#[Put('/thing')]
#[Patch('/thing')]
public function change(): Response
{
    return $this->text('changed');
}
```

The attributes are repeatable, so one method can answer several verbs or several paths. `Route` is the generic form, with the method as its second argument:

```php
#[Route('/multi', 'GET')]
#[Route('/multi-alias', 'GET')]
public function multi(): Response
{
    return $this->text('multi');
}
```

The method is an HTTP token (RFC 9110), such as `GET` or `PROPFIND`: a method holding a space or any other character outside the token is [refused at registration](#refusals-at-build-time).

Only public methods declared by the controller class itself are read. A route attribute on a method of a parent class does not register anything for the subclass.

## Prefixes with Root

`#[Root]` prefixes every route of a class. A parent class's prefix comes first, then the class's own.

```php
#[Root('/api/projects')]
final class ProjectController extends Controller
{
    #[Get('/')]
    public function index(Request $request): Response
    {
        $page = (int) $request->query('page', 1);

        return $this->json(['page' => $page]);
    }
}
```

`GET /api/projects` and `GET /api/projects/` both reach `index()`.

## Route parameters

A placeholder is a whole path segment in braces. The handler receives it by name, cast to the type you declare.

```php
#[Get('/{id}', constraints: ['id' => '\d+'], name: 'projects.show')]
public function show(int $id, int $userId): Response
{
    return $this->json(['id' => $id, 'viewer' => $userId]);
}
```

A constraint is a regular expression fragment. Without one, a placeholder matches `[^/]+`. Constrain every parameter you can: a request that does not satisfy the constraint, or whose value cannot be cast to the declared type, answers 404.

A constraint that is not a valid regular expression throws a `RouteSignatureException` on the first request that reaches the route, with PHP's reason, even under an error handler that turns warnings into exceptions:

```text
Invalid route constraint pattern for parameter "id" on route "/users/{id}": \d+( (Compilation failed: missing closing parenthesis)
```

Handler parameters are resolved in this order:

1. a parameter typed `Request` receives the request;
2. a parameter named like a placeholder of the matched route takes the URL value;
3. a parameter named like a request attribute takes that attribute, cast to its type (here `$userId`, set by a middleware);
4. any other parameter takes the next placeholder not yet claimed, by position;
5. otherwise its default value is used, and without one the call fails.

Name your parameters like the placeholders: the positional fallback exists, but it is easy to read wrongly. The query string never binds: `?n=3` leaves `int $n = 5` at 5. Read it with `$request->query()` (see [HTTP](../http/)).

A static route beats a parameterized one whatever the registration order: `/users/me` wins over `/users/{id}`. Among parameterized routes, registration order decides.

### Constraining a segment's shape

A placeholder fills a whole segment and cannot share it with text. To match `report.json`, capture the segment and constrain it:

```php
#[Get('/files/{file}', constraints: ['file' => '[a-z]+\.json'])]
```

## Naming routes

The `name` argument gives a route a name for [URL generation](#generating-urls). Names must be unique. Two attribute routes of one class sharing a name are refused (`Duplicate route name "same" discovered while reading attributes on class "Dup\A".`). Across classes, or with routes registered on the router, the repeat is refused when the application is built: `ApplicationBuilder::build()` throws a `Zephyrus\Routing\Exception\DuplicateRouteNameException` (`Duplicate route names detected: same`). Version 0.14.1 accepted a duplicate between classes, `route()` picking the first, until `$router->assertNoDuplicateRouteNames()` was called, and that call threw a `RouteSignatureException`: a `catch` on that class no longer catches it.

## Attaching middleware

`#[Middleware('auth')]` names a middleware registered on the builder, on a class or on a method. The routes then run it after the global middleware, in the order described in [Middleware](../middleware/).

```php
#[Root('/api/projects')]
#[Middleware('auth')]
final class ProjectController extends Controller
{
    // every route here runs the "auth" middleware
}
```

On a class the attribute is inherited by subclasses and runs parent first. On a method, every `#[Middleware]` runs before every `#[MiddlewareGroup]`. A route can also list names directly: `#[Get('/', middlewares: ['auth'])]`.

A group is a name for a list of middleware names. Define it on the router before the routes that use it:

```php
$router = (new Router())
    ->middlewareGroup('admin', ['auth', 'audit'])
    ->discoverControllers('App\\Controllers', $root . '/app/Controllers');
```

```php
#[Get('/admin')]
#[MiddlewareGroup('admin')]
public function admin(): Response
{
    return $this->text('admin');
}
```

### Skipping a global middleware

`#[WithoutMiddleware]` on a class or a method skips a global middleware for the routes it matches: a stateless webhook that needs no session, a health probe.

```php
use Zephyrus\Session\SessionMiddleware;

#[Get('/health')]
#[WithoutMiddleware(SessionMiddleware::class)]
public function health(): Response
{
    return $this->json(['ok' => true]);
}
```

Only a matched route skips: a 404 or 405 still runs every global middleware. Route middleware set with `#[Middleware]` is never skipped. The framework's security middleware (HTTPS redirect, allowed hosts, CSRF, body size limit, secure headers, CSP) cannot be skipped: the route is refused at registration (see [refusals](#refusals-at-build-time)).

## One codebase, several processes

`#[RequiresEnv]` registers a class or method only when an environment variable has exactly this value (case-sensitive):

```php
#[Root('/v1')]
#[RequiresEnv('MODE', 'api')]
final class StatusController extends Controller
{
    #[Get('/status')]
    public function status(): Response
    {
        return $this->json(['ok' => true]);
    }
}
```

With `MODE` unset, `GET /v1/status` is not registered and answers 404. A controller without `#[RequiresEnv]` registers in every process. The attribute is inherited by subclasses, so you can put it on an abstract base class.

## Registering without attributes

Everything attributes do is available on the router. A handler is a `Class@method` string:

```php
use App\Controllers\ReportController;

$router = (new Router())
    ->get('/reports', ReportController::class . '@index')->name('reports.index')
    ->get('/reports/{id}', ReportController::class . '@show', ['id' => '\d+'])
    ->post('/reports', ReportController::class . '@store', middlewares: ['auth'])
    ->group('/admin', fn (Router $r) => $r
        ->get('/reports', ReportController::class . '@index')->name('reports'), namePrefix: 'admin.')
    ->resource('/things', ReportController::class);
```

- `get()`, `post()`, `put()`, `patch()`, `delete()`, `head()` and `options()` take a path, a handler, constraints and middleware names; `add()` takes the method first.
- `name()` names the route just added. `withoutMiddleware()` does the same for a skipped global middleware.
- `group()` adds a prefix, shared middleware, a name prefix and `excludedMiddlewares` to every route of the callback.
- `resource()` registers the six conventional routes (`index`, `show`, `store`, `update`, `patch`, `delete`), with `{id}` limited to digits.
- `controller(ProjectController::class)` registers one class's attributes; `discoverControllers()` takes an optional third argument, `parentClass:`, to register only subclasses of a base class.

A closure is not a handler: the string form is what makes the route table cacheable.

## Generating URLs

Give a route a name, then build its URL instead of writing it by hand:

```php
use Zephyrus\Core\App;
use Zephyrus\Routing\RouteUrlGenerator;

App::setUrlGenerator(new RouteUrlGenerator($router->routes(), 'https://app.example.test'));

route('projects.show', ['id' => 12], ['tab' => 'files']);
// https://app.example.test/api/projects/12?tab=files
```

`route()` is available in PHP and in Latte once a generator is set; without a base URL it returns the path alone. Placeholder values are percent-encoded, query keys are sorted, and an optional fifth argument of `generate()` adds a fragment. You can also use the generator directly:

```php
$urls = new RouteUrlGenerator($router->routes(), 'https://app.example.test');

$urls->generate('reports.show', ['id' => 12], ['tab' => 'files', 'a' => 'b c'], 'top');
// https://app.example.test/reports/12?a=b%20c&tab=files#top
```

`generate()` throws `RouteUrlGenerationException` for an unknown name, a missing or unexpected parameter, or a value that breaks the route's constraint (for example `Route parameter "id" for route "reports.show": value "x" does not satisfy constraint "\d+"`).

### Signed URLs

Pass a `RouteSignature` with a secret from the environment to sign URLs, so a link cannot be altered:

```php
use Zephyrus\Routing\RouteSignature;

$signature = new RouteSignature($_ENV['LINK_SIGNING_SECRET']);
$urls = new RouteUrlGenerator($router->routes(), 'https://app.example.test', $signature);

$urls->generateSigned('reports.show', ['id' => 12]);
$urls->generateTemporarySigned('reports.show', 3600, ['id' => 12]); // expires in an hour
```

When the link comes back, check it with `$signature->verify($url)` (a boolean) or `$signature->assertValid($url)` (throws `RouteSignatureException`: `Invalid route signature` or `Route signature has expired`). An empty secret is refused. Verify against the full URL as the browser requested it, and use a secret that is long and random.

## 404 and 405

An unknown path answers 404. A known path with the wrong method answers 405 with an `Allow` header listing the accepted methods. A `GET` route also answers `HEAD`. A trailing slash is tolerated; call `$router->strictTrailingSlashes()` to make `/users` and `/users/` distinct.

```php
#[Get('/lookup/{id}', constraints: ['id' => '\d+'])]
public function show(int $id): Response
{
    $name = self::PROJECTS[$id] ?? throw new RouteNotFoundException('project');

    return $this->text($name);
}
```

`RouteNotFoundException` thrown from handler code answers 404 like an unknown route, so a missing record needs no special case. `$this->abort(404)` does the same without an exception. A path that is not valid UTF-8 or contains a control character is also a 404. Global middleware runs on 404 and 405 answers, so they carry your security headers.

## The router section

Instead of calling `discoverControllers()` in code, declare the controllers in `config.yml`:

```yaml
router:
  controllers:                      # required: PSR-4 namespace => directory
    App\Controllers: app/Controllers
  middleware_groups:                # optional: name => middleware or group names
    admin: [auth, audit]
  cache: var/zephyrus/routes.php    # optional, this is the default
```

The builder does the rest: when the configuration declares `router:` and there is no `withRouter()`, `build()` builds the router from the section.

```php
$app = ApplicationBuilder::buildFromConfigurationFile($root . '/config.yml');
```

- Relative paths resolve against the `basePath` (the directory of the file with `fromConfigurationFile()` and `buildFromConfigurationFile()`), never the current directory. `cache` must be a `.php` file under that root.
- No value may carry a YAML tag, `!env` included. A controller directory that is missing, or holds no class of its namespace, is refused, where `discoverControllers()` registers nothing silently.
- Write the namespace bare or in single quotes: in double quotes, `"App\Controllers"` is a YAML escape error.
- Declare the groups under `router.middleware_groups` instead of calling `Router::middlewareGroup()`.
- `Router::fromConfiguration($config, basePath: $root)` builds the same router when you need it before `build()`; pass it to `withRouter()`. Any other router given to `withRouter()` is refused when the configuration declares `router:`, so that a half-done migration cannot write a cache nobody reads:

```text
Configuration declares router.controllers, but withRouter() received a router that Router::fromConfiguration() did not build, so the routes cache would never be read. Remove the withRouter() call to let build() discover the controllers, or start the router passed to it from Router::fromConfiguration($configuration, basePath: <application root>).
```

Without a `router:` section nothing changes: `discoverControllers()` and `withRouter()` keep working, and discover the controllers on every request.

## The routes cache

In production and staging, `Router::fromConfiguration()` reads `var/zephyrus/routes.php`, the file `vendor/bin/zephyrus cache:warm` writes, instead of scanning and reflecting the controllers. In development and testing it always discovers them. When the cache is absent, stale or refused, or when `basePath` holds no `config.yml`, the router falls back to discovery and logs one line, for example:

```text
Zephyrus: no routes cache at /var/www/html/var/zephyrus/routes.php, so the controllers were discovered for this request. Run vendor/bin/zephyrus cache:warm to write it.
```

- The cache is stale once `config.yml`, a file under a controller directory, or the file of a parent class, trait or interface of a controller changes (to the second). A constant of another class read by an attribute is not tracked: run `cache:warm` on every build.
- `#[RequiresEnv]` is evaluated on every request, so one cache serves every `MODE` and `APP_ENV`.
- The cache holds every route path, name and constraint in clear: never build a route from a secret.
- Two routes of one name that can be registered together are refused, by the warm and by the discovery in development.

Writing the caches belongs to the build of the image: see [Caches and deployment](../configuration/#caches-and-deployment). On an application of about 340 routes with OPcache, reading the cache brings the routes from 6-8 ms to 1.3-1.6 ms per request.

Version 0.15.0 exposed `RouteCache` (`new RouteCache($file)`, `has()`, `load()`, `save()`, `warm()`, `warmIfStale()`, `isFresh()`, `inspect()` and the rest) and left you to write and read a JSON file. That API is gone: `RouteCache` is internal, and a cache is judged by what it was read from, not by its age. Delete the code that warms or inspects a `RouteCache`, add the `router:` section and run `vendor/bin/zephyrus cache:warm`.

## Refusals at build time

The router refuses a route it cannot serve correctly, at registration, so a mistake fails at boot and not in production traffic.

A route naming a middleware or group that was never registered is refused when the application is built:

```text
Route middlewares are not registered: "admin" on GET /misc/admin, "auth" on 5 routes (GET /api/projects, GET /api/projects/{id}, GET /api/projects/{id}/files/{name}, ...); no middleware is registered. Register each with registerMiddleware() before build(), or, for a group, define it with Router::middlewareGroup() before the routes that name it.
```

Method and path refusals (`RouteSignatureException`):

```text
Invalid route method "GE T" on route "/x": an HTTP method is a token of letters, digits and !#$%&'*+-.^_`|~ (RFC 9110), such as GET or PROPFIND
Invalid route path "/a?x=1": the request path ends at "?", so this route would only match "/a"; declare "/a" and read the query string from the request
Invalid route parameter name "id?" on route "/a/{id?}": optional placeholders are not supported; declare a second route without that segment
Invalid route parameter name "1x" on route "/a/{1x}": a placeholder must match /^[A-Za-z_][A-Za-z0-9_]*$/D
Duplicate route parameter name "id" on route "/a/{id}/{id}": only the last occurrence would survive, so the earlier segment would match unchecked
Invalid route path "/a/{id}.json": segment "{id}.json" mixes a placeholder with text; capture the whole segment with a constraint or give the placeholder its own segment
Reserved route parameter name "_zephyrus_x" on route "/a/{_zephyrus_x}": the framework publishes this attribute itself, so a URL segment must not be able to supply it
```

Middleware refusals (`RouteMiddlewareException`):

```text
Route "GET /a" cannot skip "Zephyrus\Security\CsrfMiddleware": it is a framework security middleware. Exempt the path under security.csrf.exceptions instead
Circular middleware group reference detected: a -> b -> a
```

## Good to know

- The router is immutable. `$router->get(...)` on its own line registers nothing; reassign it or chain.
- `discoverControllers()` registers nothing, silently, when the directory or namespace is wrong: a missing directory returns the router unchanged and a class that does not match the namespace is skipped. Check `$router->count()` while you set up, or use the `router:` section, which refuses both.
- Route attributes on a parent class's methods do not apply to subclasses; `#[Root]`, `#[Middleware]` and `#[RequiresEnv]` on the parent class do.
- Declare middleware groups before `discoverControllers()`: a group is expanded when a route is added. With the `router:` section, declare them under `router.middleware_groups`.
- Two attribute routes of one class sharing a name are refused when the class is registered; any other duplicate name stops `build()` with `DuplicateRouteNameException`.
- A `POST` carrying a `_method` field or an `X-HTTP-Method-Override` header of `PUT`, `PATCH` or `DELETE` is routed as that method when the request comes from `Request::fromGlobals()`.
