---
title: The application
order: 2
description: How ApplicationBuilder assembles an Application from a configuration, a router and middleware, and how a request travels through HttpKernel.
---

# The application

One builder, one `handle()`.

A Zephyrus application is an object that turns a `Request` into a `Response`. You assemble it with `ApplicationBuilder`, then either send its response to the browser or, in tests, read it. There is no framework front controller to extend: the glue is a small class of your own.

## A bootstrap class

This is a complete bootstrap. `public/index.php` calls it, and your tests call `application()` directly.

```php
namespace App;

use App\Exceptions\OrderNotFound;
use App\Services\Greeter;
use Zephyrus\Container\Container;
use Zephyrus\Core\Application;
use Zephyrus\Core\ApplicationBuilder;
use Zephyrus\Core\Config\Configuration;
use Zephyrus\Core\ExceptionEvent;
use Zephyrus\Event\EventDispatcher;
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Routing\Router;
use Zephyrus\Security\CsrfConfig;
use Zephyrus\Security\CsrfMiddleware;
use Zephyrus\Security\MaxBodySizeMiddleware;
use Zephyrus\Security\SecureHeadersMiddleware;
use Zephyrus\Session\SessionCsrfTokenManager;
use Zephyrus\Session\SessionManager;
use Zephyrus\Session\SessionMiddleware;

final class Kernel
{
    public static function run(string $root): void
    {
        $config = Configuration::fromYamlFile($root . '/config.yml');

        $request = Request::fromGlobals(
            trustedProxies: $config->security->trustedProxies,
            trustedHeaders: $config->security->trustedHeaders,
        );

        self::application($root, $config)->handle($request)->send();
    }

    public static function application(string $root, Configuration $config): Application
    {
        $session = new SessionManager();
        $tokens = new SessionCsrfTokenManager($session);

        $container = new Container();
        $container->singleton(Greeter::class, fn (): Greeter => new Greeter('Hello'));

        $events = new EventDispatcher();
        $events->addListener(ExceptionEvent::class, function (ExceptionEvent $event): void {
            if (!$event->isRoutingFailure()) {
                error_log($event->getException()::class . ': ' . $event->getException()->getMessage());
            }
        });

        $router = (new Router())->discoverControllers('App\\Controllers', $root . '/app/Controllers');

        return ApplicationBuilder::create()
            ->withConfiguration($config, basePath: $root)
            ->withRouter($router)
            ->withContainer($container)
            ->withEventDispatcher($events)
            ->withExceptionHandler(
                OrderNotFound::class,
                fn (\Throwable $e, Request $request): Response => Response::html('<h1>No such order</h1>', 404),
            )
            ->withMiddleware(new SecureHeadersMiddleware($config->security->headers))
            ->withMiddleware(new MaxBodySizeMiddleware($config->security->maxBodySize))
            ->withMiddleware(new SessionMiddleware($config->session, $session))
            ->withMiddleware(new CsrfMiddleware($tokens, CsrfConfig::fromSecurityConfig($config->security)))
            ->build();
    }
}
```

```php
// public/index.php
require dirname(__DIR__) . '/vendor/autoload.php';

App\Kernel::run(dirname(__DIR__));
```

`Request::fromGlobals()` does not read `config.yml`: pass the proxy settings yourself, as above. The `.env` file is not read either, see [Configuration](../configuration/#environment-variables).

## The builder

`ApplicationBuilder` is immutable: every `with*()` method returns a new builder. A call whose result you drop mounts nothing, so chain the calls or reassign (`$builder = $builder->withMiddleware(...)`). `build()` returns the `Application`.

| Method | What it wires |
| --- | --- |
| `withConfiguration($config, basePath: $root)` | The configuration: localization (a relative `locale_path` resolves against `basePath`). `build()` applies `application.debug` and `localization.timezone` |
| `withRouter($router)` | The router. Without one, every request answers 404 |
| `withMiddleware($m)` | A global middleware: it runs on every request, 404 and 405 included, the first one added outermost |
| `registerMiddleware('name', $m)` | Gives a middleware a name that routes can reference. It runs only on those routes |
| `withContainer($container)` | Builds controllers through the container |
| `withControllerFactory($callable)` | Builds controllers with your own `callable(class-string): object` |
| `withRenderEngine($engine)` | Shares a view engine with every controller that uses `RenderResponses` |
| `withEventDispatcher($events)` | The dispatcher that receives the kernel events. Without one, no event fires |
| `withExceptionHandler($class, $callable)` | Maps an exception class to a response: see [Errors](../errors/) |
| `withDebugClientAllowlist(...)`, `withProductionDebugAcknowledged()` | Who may see the debugger: see [Errors](../errors/) |
| `withAcknowledgedSecurityKeys([...])`, `withoutSecurityWiringCheck()` | The boot-time security check: see [Security](../security/) |

Localization has its own entry points: `withLocalizationConfig()`, `withJsonLocales($path)`, `withJsonLocaleLayers($paths)`, `withFallbackLoaders($loaders)`, `withLocaleLoader($loader)` and `withSupportedLocales($locales)`. See [Localization](../localization/).

You can also start from a configuration instead of adding it afterwards: `ApplicationBuilder::fromConfiguration($config)`, `fromConfigurationFile($path)`, `fromConfigurationArray($array)`, `fromConfigurationFiles($paths)`, `fromOptionalConfigurationFiles($paths)` (missing files are skipped), and the `buildFrom...()` variants that return the `Application` directly. `withConfigurationFile()`, `withConfigurationFiles()`, `withOptionalConfigurationFiles()` and `withConfigurationArray()` do the same on an existing builder.

### Discover controllers

`Router::discoverControllers($namespace, $directory)` registers every class under the directory whose attributes declare a route. The namespace is the PSR-4 prefix of that directory, and the directory is an absolute path. A directory that does not exist, or a namespace that does not match, registers nothing and raises no error: if a route answers 404, check these two arguments first. See [Routing](../routing/) and [Controllers](../controllers/).

### Controllers through the container

`withContainer()` resolves each controller through a [container](../../digging-deeper/container-and-events/), so constructor dependencies are injected:

```php
use Zephyrus\Controller\Controller;
use Zephyrus\Routing\Attribute\Get;

final class HelloController extends Controller
{
    public function __construct(private readonly Greeter $greeter)
    {
    }

    #[Get('/hello/{name}')]
    public function hello(string $name): Response
    {
        return $this->json(['message' => $this->greeter->greet($name)]);
    }
}
```

A class the container has no binding for is built by auto-wiring its typed constructor. `withControllerFactory()` and `withContainer()` set the same hook: the last one called wins. `withRenderEngine()` keeps working with both.

### Global versus named middleware

Only a middleware passed to `withMiddleware()` counts for the security wiring check. One registered by name, or wrapped inside another middleware, does not. See [Middleware](../middleware/) for ordering and route middleware.

## Handle a request

`Application` is a read-only object with one job:

```php
$response = $app->handle(Request::fromArray('GET', '/hello/ada'));

$response->status;           // 200
$response->body;             // {"message":"Hello, ada"}
```

In production, `Kernel::run()` ends with `->send()`, which writes the status line, the headers and the body. In a test, you keep the `Response` and assert on it: no server is needed.

```php
$app = Kernel::application($root, Configuration::fromYamlFile($root . '/config.yml'));
$response = $app->handle(Request::fromArray('GET', '/hello/ada'));
```

`Request::fromArray()` builds a request from plain values (`body:`, `query:`, `headers:`, `cookies:`). `Request::fromGlobals()` builds one from the PHP superglobals, and belongs in `public/index.php` only.

`Application` also exposes the translator: `trans($key, $parameters, $locale)`, `transFromRequest(...)` and `resolveLocaleFromRequest(...)`. See [Localization](../localization/).

### The App registry

`build()` registers the services that helpers such as `config()`, `route()`, `localize()` and `format()` read: the configuration, translator, formatter and URL generator. They live in static properties of `Zephyrus\Core\App` (`App::getConfiguration()`, `getTranslator()`, `getFormatter()`, `getUrlGenerator()`, `getSession()`, `getAsset()`, and the matching setters), plus `App::nonce()` for the Content-Security-Policy nonce.

This assumes one request per process, as php-fpm and mod_php run. Persistent workers (RoadRunner, Swoole, FrankenPHP worker mode) are not supported: `App::reset()` clears the registry for tests, it is not a between-requests hook.

A command-line script that never calls `build()` must set the formatter itself, or `format('decimal', 1234.5)` throws:

```php
App::setFormatter(new Formatter('en_CA'));
```

## The request lifecycle

`HttpKernel` runs every request in the same order:

1. A `RequestEvent` is dispatched. A listener may answer on its own with `setResponse()`, which skips routing.
2. The router matches the request. The route's parameters are known before any middleware runs.
3. The global middlewares run, outermost first, around the matched controller action. For an unknown path or a wrong method they run around the 404 or 405 answer instead.
4. The controller runs (route middlewares wrap it).
5. A `ResponseEvent` is dispatched. A listener may replace the response.

When something throws in step 2, 3 or 4, the kernel dispatches an `ExceptionEvent`, then converts the exception into a response (see [Errors](../errors/)). The error response still passes through the global middlewares, so it carries your security headers.

Three responses skip the global middlewares: a `RequestEvent` short-circuit, the fallback used when a global middleware itself throws, and a response replaced by a `ResponseEvent` listener. A header that must reach every response also belongs in the web server or the proxy.

The events are covered in [Container and events](../../digging-deeper/container-and-events/#kernel-events).

## The security wiring check

Declaring a key under `security:` is a promise: `build()` refuses to boot when no global middleware enforces it. See [Security](../security/) for the table of keys and the middleware each one needs.

```text
Configuration declares security settings that this application does not enforce as declared:
  - security.csrf is not enforced as declared: mount new Zephyrus\Security\CsrfMiddleware(...) globally with withMiddleware(), ...
```

### Good to know

- The first middleware added runs outermost. Put `SecureHeadersMiddleware` first.
- `build()` sets the default timezone, and turns the debugger on or off. Both are process-wide.
- `withRenderEngine()` returns a new builder like every other method: `$builder->withRenderEngine($views);` alone does nothing.
- Global middlewares also run on 404 and 405 answers, so their side effects (starting a session, for example) happen there too. A route can opt out of a global middleware with `#[WithoutMiddleware]`.
