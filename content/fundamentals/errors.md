---
title: Errors and debugging
order: 14
description: What a client receives when something fails, how to report and customize errors, how the Tracy debugger is gated, and how to read the framework's exceptions.
---

# Errors and debugging

A fixed answer for the client, the details for you.

When an exception escapes a controller or a middleware, `HttpKernel` turns it into a response. The client gets a short, fixed answer. The exception message and trace never reach it: they are for your logs. This page starts with the configuration that is safe to deploy, then covers each piece.

## A safe production setup

In production, leave debug off and report errors through an event listener. The environment decides, and the safe value is the default:

```yaml
application:
  environment: !env APP_ENV, production
  debug: !env APP_DEBUG, false
```

```php
use Zephyrus\Core\ApplicationBuilder;
use Zephyrus\Core\ExceptionEvent;
use Zephyrus\Event\EventDispatcher;

$events = new EventDispatcher();
$events->addListener(ExceptionEvent::class, function (ExceptionEvent $event): void {
    if (!$event->isRoutingFailure()) { // skip 404 and 405
        error_log($event->getException()::class . ': ' . $event->getException()->getMessage());
    }
});

$app = ApplicationBuilder::create()
    ->withConfiguration($config, basePath: $root)
    ->withRouter($router)
    ->withEventDispatcher($events)
    ->build();
```

With this setup an uncaught exception becomes a `500` with a fixed body, and the line above lands in your error log. Nothing else is needed for a configuration that declares no `security:` settings (when it does, the matching middlewares must be mounted: see [Security](../security/)), apart from the PHP settings below. The exception handlers below only change what the client sees.

Neither this page's setup nor the framework turns PHP's own `display_errors` off, and PHP's built-in default is on when no `php.ini` is loaded. A boot failure outside the kernel, such as a configuration typo, is then printed with its trace and vendor path. Production needs `display_errors=Off`, `display_startup_errors=Off` and `log_errors=On`: see [PHP settings for production](../../getting-started/installation/#php-settings-for-production).

Without an event dispatcher, a failure reaches nobody: the client gets the fixed answer and the message is dropped. Register the listener.

## What the client receives

The built-in answers carry a fixed message, never the exception's:

| Cause | Status | Notes |
| --- | --- | --- |
| No route matched, or a route parameter does not cast to its type | 404 | `Not Found` |
| A route exists for another method | 405 | `Method Not Allowed`, with an `Allow` header |
| A `ValidationException` | 422 | the field errors, in the JSON formats only |
| Anything else | 500 | `Internal Server Error` |

`HttpExceptionResponder` picks the format from the `Accept` header. A plain request, a browser (`text/html`) and `*/*` get `text/plain`. A request that accepts `application/json` gets an envelope built by `HttpErrorPayload`, and one that prefers `application/problem+json` gets a problem document:

```text
GET /nope        (Accept: text/html)
404  Not Found

GET /nope        (Accept: application/json)
404  {"error":{"status":404,"message":"Not Found"}}

GET /nope        (Accept: application/problem+json)
404  {"type":"about:blank","title":"Not Found","status":404}

GET /invalid     (Accept: application/json)
422  {"errors":{"email":["Enter a valid email address."]}}
```

The built-in answers are never HTML pages. A page that matches your layout is yours to write, below.

## Your own error pages

`withExceptionHandler()` maps an exception class to a response. The handler receives the throwable and the request, and returns a `Response`, or `null` to decline and keep the built-in answer.

```php
use Zephyrus\Routing\Exception\RouteNotFoundException;
use Zephyrus\Routing\Exception\RouteParameterException;

$notFound = fn (\Throwable $e, Request $request): Response
    => Response::html('<h1>Page not found</h1>', 404);

$builder = $builder
    ->withExceptionHandler(RouteNotFoundException::class, $notFound)
    ->withExceptionHandler(RouteParameterException::class, $notFound);
```

When several handlers match, the most specific class wins. A handler on `\Throwable` is a catch-all, and it also receives the exceptions the framework maps itself (`ValidationException`, `MethodNotAllowedException`, `RouteNotFoundException` and `RouteParameterException`). Decline for those, or your page replaces their 422, 405 and 404:

```php
use Zephyrus\Routing\Exception\MethodNotAllowedException;
use Zephyrus\Routing\Exception\RouteNotFoundException;
use Zephyrus\Routing\Exception\RouteParameterException;
use Zephyrus\Validation\ValidationException;

$builder = $builder->withExceptionHandler(
    \Throwable::class,
    function (\Throwable $e, Request $request): ?Response {
        if (
            $e instanceof ValidationException
            || $e instanceof MethodNotAllowedException
            || $e instanceof RouteNotFoundException
            || $e instanceof RouteParameterException
        ) {
            return null;
        }
        error_log($e::class . ': ' . $e->getMessage());

        return Response::html('<h1>Something went wrong</h1>', 500);
    },
);
```

The page is fixed text. Never put `$e->getMessage()` or a trace in the body: a message can hold a host name, a SQL fragment or a credential. A handler does not see the attributes that route middlewares set on the request.

A handler that itself throws produces the fixed `500` text, and the failure is reported as an `ExceptionEvent`. A handler on a client-visible page should also look at `Accept` if the same route serves JSON clients:

```php
$wantsJson = str_contains($request->headers()->get('accept') ?? '', 'json');
```

## Listening to errors

The kernel fires an `ExceptionEvent` each time it converts a throwable, which makes it the one place to report errors. A middleware that catches, reports and rethrows never sees them: the conversion happens inside the global pipeline, so `$next()` returns the error response instead of throwing.

| Method | Returns |
| --- | --- |
| `getException()` | the throwable being converted |
| `getRequest()` | the request |
| `getSource()` | where it came from: `routing`, `handler`, `middleware` or `responder` |
| `isRoutingFailure()` | `true` for a 404 or 405 |

The sources are constants on the class: `ExceptionEvent::SOURCE_ROUTING` (no route matched), `SOURCE_HANDLER` (the matched action or a route middleware threw), `SOURCE_MIDDLEWARE` (a global middleware threw) and `SOURCE_RESPONDER` (an exception handler or the responder itself threw).

```php
$events->addListener(ExceptionEvent::class, function (ExceptionEvent $event): void {
    error_log(json_encode([
        'exception' => $event->getException()::class,
        'path' => $event->getRequest()->path(),
        'source' => $event->getSource(),
    ], JSON_THROW_ON_ERROR));
});
```

The event is observation only: a listener cannot replace the response. A listener that throws is logged (`an ExceptionEvent listener failed and was skipped`) and the remaining listeners still run, so a broken tracker never turns an error into a blank page. See [Container and events](../../digging-deeper/container-and-events/) for the dispatcher.

## Debugging in development

With `application.debug: true` in a development or testing environment, `build()` enables the [Tracy](https://tracy.nette.org) debugger. Tracy always admits loopback clients, and nobody else unless they are on the allowlist below. It recognises a proxy only by an `X-Forwarded-For` or `Forwarded` header, so debug must stay off unless every proxy in front of PHP sends `X-Forwarded-For` (nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). A remote client behind a proxy that sends no such header looks like a local one and gets the full error page. Its output includes stack-trace arguments, the environment and cookies, so it must never reach every client.

Enabling debug does not show an exception by itself. With `APP_ENV=dev` and `APP_DEBUG=true`, a controller that throws still answers a plain `Internal Server Error`, and nothing is logged until an `ExceptionEvent` listener (the one in the first example) writes it to the error log.

The kernel catches exceptions before Tracy sees them. To get Tracy's page for an error, let the exception out of a handler in development only:

```php
$debug = $builder->isDebugEnabledForBoot();

$builder = $builder->withExceptionHandler(
    \Throwable::class,
    function (\Throwable $e, Request $request) use ($debug): ?Response {
        if ($debug) {
            throw $e; // the same object: handle() rethrows it, so Tracy can show it
        }
        error_log($e::class . ': ' . $e->getMessage());

        return Response::html('<h1>Something went wrong</h1>', 500);
    },
);
```

Take `$debug` from `isDebugEnabledForBoot()` on the fully configured builder (after `withConfiguration()`). Never take it from `$config->application->debug`: in production that value can be `true` while debug is actually off, and a rethrow with no debugger behind it reaches PHP's own error handler, which prints the message, the server paths and the trace when `display_errors` is on. In production this handler answers with the fixed page above and never rethrows.

### Production forces debug off

In `production` and `staging`, `build()` turns debug off whatever the file says, and logs why:

```text
Zephyrus: application.debug is true while application.environment is production-like. Debug output has been FORCED OFF for this boot: ...
```

An unrecognized environment name (`prodution`) is production too, so a typo fails safe. To debug a live tier on purpose, call `withProductionDebugAcknowledged()` in your bootstrap code. It is code on purpose, not a configuration key: a configuration value is what gets flipped on a server and forgotten. Even then, the clients below (and loopback) are the only ones meant to see anything, provided the proxy rule above holds.

```php
$builder = $builder->withProductionDebugAcknowledged();
```

### The client allowlist

Behind Docker, the browser reaches PHP from the bridge gateway, not from loopback. Name that client, with a secret that you also send in a `tracy-debug` cookie:

```php
// DEBUG_CLIENTS holds "secret@172.17.0.1"; unset or empty names no client beyond loopback.
$builder = $builder->withDebugClientAllowlist(env('DEBUG_CLIENTS'));
```

An entry is an exact address, or `secret@address`, which also requires the cookie `tracy-debug=secret`. A string may list several entries separated by commas or spaces, or you can pass an array with one entry per element. Entries are checked when you register them:

| Entry | Refusal |
| --- | --- |
| `@172.17.0.1` | `Debug client allowlist entry 1 has an empty secret before "@": with no tracy-debug cookie it would admit every client at that address. Set a secret, or list the bare address if that is intended.` |
| `secret@` | `Debug client allowlist entry 1 has no address after "@".` |
| `10.0.0.0/8` | `Debug client allowlist entry 1 is a range: Tracy matches exact addresses only, so list each address.` |
| array element `'a b'` | `Debug client allowlist entry 1 holds whitespace or a comma: pass each address as its own array entry.` |

A bare address with no secret admits anyone who can reach PHP from it, so prefer `secret@address`. The messages name the position of the entry and never repeat the secret.

The secret is a credential. Keep it in the environment, never in git. The framework keeps it, and the other secrets it knows about, out of the debugger's output: the allowlist property of the builder and the `tracy-debug` cookie are masked in dumps and traces, along with `password`, `token`, `secret`, `apiKey`, `authorization` and `cookie` keys, the encryption key, the session cookie and the raw request body (`DebugIntegration::SENSITIVE_KEYS` lists the exact names and `isSensitiveKey()` tests one). The Bluescreen also masks by pattern, but only string values: a numeric secret still needs to be added to Tracy's `keysToHide` by name.

### Good to know

- Enabling the debugger stores real argument values in every exception trace of the process, including the ones that only go to a log. Keep debug off wherever a log leaves the server.
- `Debugger::enable()` is global and cannot be undone for the rest of the process. That is why `isDebugEnabledForBoot()` reports the decision without enabling anything.
- Tracy is initialized by `build()`. You do not call `DebugIntegration::initialize()` yourself.

## The exception classes

Every framework refusal is an exception whose message tells you what to fix. Read it as an instruction: it names the section, the key, the class or the argument, and says what to change.

| Class | Raised for |
| --- | --- |
| `ZephyrusException` | the base class of everything below |
| `ZephyrusRuntimeException` | the base of failures at run time |
| `ConfigurationException` | an invalid configuration, or an unwired security setting, at boot |
| `ContainerException`, `NotFoundException` | an entry the container cannot resolve |
| `RouteNotFoundException`, `RouteParameterException`, `MethodNotAllowedException` | a request that matches no route (404, 404, 405) |
| `RouteSignatureException`, `RouteAttributeException`, `RouteMiddlewareException` | a route declared wrongly, found at boot |
| `ValidationException` | a failed validation (422), carrying its `ErrorBag` |
| `SessionException`, `DatabaseException`, `MailerException`, `UploadException`, `RenderException`, `CryptographyException`, `LocalizationException`, `FormatterException`, `FileSystemException` | the matching module |

Catch `ZephyrusException` to handle anything the framework throws on purpose:

```php
use Zephyrus\Core\Config\Configuration;
use Zephyrus\Exceptions\ZephyrusException;

try {
    $config = Configuration::fromYamlFile($root . '/config.yml');
} catch (ZephyrusException $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
```

A boot error is addressed to you, and belongs on the console or in the log. It reaches a page only when PHP's `display_errors` is on, which is why production sets it to `Off` (see above). The messages are stable enough to search for. These are the ones you will meet first:

```text
Configuration key 'sesion' is not a known section: did you mean "session"? ...
Configuration section 'security' field 'max_bdy_size' is an unknown key: did you mean "max_body_size"?
Configuration declares security settings that this application does not enforce as declared: ...
```

The first two are covered in [Configuration](../configuration/#strict-validation), the third in [Security](../security/). Messages that quote a value (an environment name, a class) escape control characters, so a log line cannot be forged through them.

### Good to know

- An error in a global middleware is converted without re-entering the middleware pipeline, so that response carries no global headers. A handler error is converted inside it, and does carry them.
- `withExceptionHandler()` for the same class twice replaces the first handler.
