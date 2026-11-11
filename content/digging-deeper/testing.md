---
title: Testing
order: 8
description: Test an application in process with PHPUnit by sending requests through Application::handle(), with CSRF, sessions, JSON endpoints and middleware.
---

# Testing

No server, no browser, real requests.

`Application::handle()` turns a `Request` into a `Response` without a web server, so a test exercises the routing, middleware, controller and view of your application as one. The examples run on PHPUnit 13, which `composer require --dev phpunit/phpunit` installs today, and use the application of the [first application](../../getting-started/first-application/) page plus a small JSON endpoint.

Install PHPUnit and map the test namespace:

```bash
composer require --dev phpunit/phpunit
```

```json
"autoload-dev": { "psr-4": { "Tests\\": "tests/" } }
```

`phpunit.xml`:

```xml
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true"
         failOnWarning="true"
         failOnRisky="true">
    <testsuites>
        <testsuite name="app">
            <directory>tests</directory>
        </testsuite>
    </testsuites>
</phpunit>
```

Run the suite with `vendor/bin/phpunit`. Treating warnings and risky tests as failures keeps the suite honest.

## A base class

Build the application in `setUp()`, so that every test starts from a clean state. This base class does it and adds three helpers:

```php
<?php

declare(strict_types=1);

namespace Tests;

use App\Kernel;
use PHPUnit\Framework\TestCase;
use Zephyrus\Core\App;
use Zephyrus\Core\Application;
use Zephyrus\Core\Config\Configuration;
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;

abstract class ApplicationTestCase extends TestCase
{
    private Application $app;

    protected function setUp(): void
    {
        $root = dirname(__DIR__);
        $this->app = Kernel::application($root, Configuration::fromYamlFile($root . '/config.yml'));
    }

    protected function tearDown(): void
    {
        $_SESSION = [];
        App::reset();
    }

    protected function handle(Request $request): Response
    {
        return $this->app->handle($request);
    }

    /**
     * @param array<string, string> $headers
     */
    protected function get(string $uri, array $headers = []): Response
    {
        return $this->handle(Request::fromArray('GET', $uri, headers: $headers));
    }

    /**
     * @param array<string, mixed> $body
     */
    protected function post(string $uri, array $body): Response
    {
        $body['_csrf_token'] = $this->csrfToken();

        return $this->handle(Request::fromArray('POST', $uri, body: $body));
    }

    protected function csrfToken(): string
    {
        preg_match('/name="_csrf_token" value="([0-9a-f]+)"/', $this->get('/')->body, $found);
        self::assertNotEmpty($found, 'The home page renders no CSRF field.');

        return $found[1];
    }
}
```

- `Kernel::application()` is the bootstrap method from the first application: it returns the built `Application` and sends nothing.
- `Request::fromArray()` builds a request without touching the PHP globals. `body:` takes the already decoded body.
- `App::reset()` clears the statics the application holds (configuration, session, formatter, translator, the URL generator behind `route()` and so on). Only `build()` installs them again, which is why `setUp()` builds a new application for every test.
- `$_SESSION = []` is a separate and required step, see [Isolating tests](#isolating-tests).

## Reading a response

A `Response` has a `status`, a `body` and headers. Read headers with `getHeader()`, which ignores case: header names are stored lowercased, so `$response->headers['Content-Type']` does not exist.

```php
<?php

declare(strict_types=1);

namespace Tests;

use Zephyrus\Http\Request;

final class NotesPageTest extends ApplicationTestCase
{
    public function testTheListStartsEmpty(): void
    {
        $response = $this->get('/');

        self::assertSame(200, $response->status);
        self::assertStringContainsString('No notes yet.', $response->body);
    }

    public function testAPostWithoutTheTokenIsRefused(): void
    {
        $response = $this->handle(Request::fromArray('POST', '/notes', body: ['text' => 'Milk']));

        self::assertSame(403, $response->status);
    }

    public function testAnAddedNoteIsListedAfterTheRedirect(): void
    {
        $added = $this->post('/notes', ['text' => 'Milk']);
        $list = $this->get('/');

        self::assertSame(302, $added->status);
        self::assertSame('/', $added->getHeader('Location'));
        self::assertStringContainsString('<li>Milk</li>', $list->body);
        self::assertStringContainsString('Note added.', $list->body);
    }

    public function testABlankNoteIsShownBackWithItsError(): void
    {
        $response = $this->post('/notes', ['text' => '   ']);

        self::assertSame(422, $response->status);
        self::assertStringContainsString('role="alert"', $response->body);
    }

    public function testTheHomePageCarriesTheSecurityHeaders(): void
    {
        $response = $this->get('/');

        self::assertSame('DENY', $response->getHeader('X-Frame-Options'));
    }
}
```

## Posting a form

A state-changing request must pass the CSRF middleware like a browser would. The helper loads the page, reads the token out of the rendered form and sends it back in `_csrf_token`. The same process-wide session is why the token read by a `GET` is valid for the next `POST`.

A request without the token is refused with `403`: assert that too, so that removing the middleware is noticed.

## Keeping a session between two requests

In process there is no cookie to carry: the session is the same for every request until you clear it. `testAnAddedNoteIsListedAfterTheRedirect()` above posts a note, then requests the list and finds the note, with nothing else to set up. The flash message is shown on that second request only.

## A JSON endpoint

The endpoint of this test class lives in `app/Controllers/ApiController.php` behind a `require-json` middleware (shown below). A JSON client sends the token in the `X-CSRF-Token` header and an `Accept` header.

```php
<?php

declare(strict_types=1);

namespace Tests;

use Zephyrus\Http\Request;

final class ApiTest extends ApplicationTestCase
{
    private const JSON = ['Accept' => 'application/json'];

    public function testTheEndpointAnswersJsonWithItsVersionHeader(): void
    {
        $response = $this->get('/api/notes', self::JSON);

        self::assertSame(200, $response->status);
        self::assertSame('application/json; charset=utf-8', $response->getHeader('Content-Type'));
        self::assertSame('1', $response->getHeader('X-Api-Version'));
        self::assertSame(['notes' => []], json_decode($response->body, true));
    }

    public function testARequestThatDoesNotAcceptJsonIsRefusedByTheMiddleware(): void
    {
        $response = $this->get('/api/notes', ['Accept' => 'text/html']);

        self::assertSame(406, $response->status);
        self::assertNull($response->getHeader('X-Api-Version'));
    }

    public function testAJsonPostWithTheTokenHeaderStoresTheNote(): void
    {
        $response = $this->handle(Request::fromArray(
            'POST',
            '/api/notes',
            body: ['text' => 'Milk'],
            headers: [...self::JSON, 'X-CSRF-Token' => $this->csrfToken()],
        ));

        self::assertSame(201, $response->status);
        self::assertSame(['notes' => ['Milk']], json_decode($response->body, true));
        self::assertSame(['notes' => ['Milk']], json_decode($this->get('/api/notes', self::JSON)->body, true));
    }

    public function testAnInvalidPayloadIsAnswered422WithItsErrors(): void
    {
        $response = $this->handle(Request::fromArray(
            'POST',
            '/api/notes',
            body: ['text' => ''],
            headers: [...self::JSON, 'X-CSRF-Token' => $this->csrfToken()],
        ));

        self::assertSame(422, $response->status);
        self::assertArrayHasKey('text', json_decode($response->body, true)['errors']);
    }
}
```

```php
<?php

declare(strict_types=1);

namespace App\Controllers;

use Zephyrus\Controller\Controller;
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Routing\Attribute\Get;
use Zephyrus\Routing\Attribute\Middleware;
use Zephyrus\Routing\Attribute\Post;
use Zephyrus\Validation\FormValidator;
use Zephyrus\Validation\Rules;

#[Middleware('require-json')]
final class ApiController extends Controller
{
    #[Get('/api/notes')]
    public function index(): Response
    {
        return $this->json(['notes' => session('notes', [])]);
    }

    #[Post('/api/notes')]
    public function add(Request $request): Response
    {
        $form = new FormValidator(['text' => [Rules::required(), Rules::notBlank(), Rules::maxLength(120)]]);
        $errors = $form->validate($request->body()->all());
        if ($errors->hasErrors()) {
            return $this->json(['errors' => $errors->toArray()], 422);
        }

        $notes = session('notes', []);
        $notes[] = trim((string) $request->body()->get('text'));
        session(['notes' => $notes]);

        return $this->created(['notes' => $notes]);
    }
}
```

`Request::fromArray()` takes the decoded body in `body:` and does not decode a JSON `rawBody:`. Pass the array a client would have sent.

## A middleware

Test a middleware on its own by calling `process()` with a request and a `$next` closure, then once through a route to check it is mounted. This is the middleware under test, registered in the bootstrap with `#[Middleware('require-json')]` on the controller. The `Kernel` of the first application registers it on the builder, before `build()`:

```php
->registerMiddleware('require-json', new RequireJson())
```

The class:

```php
<?php

declare(strict_types=1);

namespace App\Http;

use Zephyrus\Http\MiddlewareInterface;
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;

final class RequireJson implements MiddlewareInterface
{
    public function process(Request $request, callable $next): Response
    {
        if (!str_contains($request->getHeader('Accept', ''), 'application/json')) {
            return Response::json(['error' => 'This endpoint answers JSON only.'], 406);
        }

        return $next($request)->withHeader('X-Api-Version', '1');
    }
}
```

```php
<?php

declare(strict_types=1);

namespace Tests;

use App\Http\RequireJson;
use PHPUnit\Framework\TestCase;
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;

final class RequireJsonTest extends TestCase
{
    public function testARequestAcceptingJsonReachesTheHandler(): void
    {
        $reached = false;
        $next = function (Request $request) use (&$reached): Response {
            $reached = true;

            return Response::json(['ok' => true]);
        };

        $response = (new RequireJson())->process(Request::fromArray('GET', '/x', headers: ['Accept' => 'application/json']), $next);

        self::assertTrue($reached);
        self::assertSame('1', $response->getHeader('X-Api-Version'));
    }

    public function testAnyOtherRequestIsStoppedBeforeTheHandler(): void
    {
        $next = static fn (Request $request): Response => self::fail('The handler must not run.');

        $response = (new RequireJson())->process(Request::fromArray('GET', '/x'), $next);

        self::assertSame(406, $response->status);
    }
}
```

The second test passes a `$next` that fails the test if it runs: it proves the request is stopped before the controller. The route-level tests in `ApiTest` prove the registration.

## Isolating tests

Because the PHP session lives for the whole process and `handle()` returns no `Set-Cookie`, a note added by one test is still there for the next. Without `$_SESSION = []` in `tearDown()` a test passes or fails depending on the order the others ran in. Run the suite in random order to catch it:

```bash
vendor/bin/phpunit --order-by=random
```

With the line removed from the base class above, this suite failed on every random order tried. With it, it passed on every one.

## Good to know

- Assert on the status and the body a client would see (`403`, `404`, `405`, `422`), never on a trace or an exception message.
- A test that needs PostgreSQL needs a real database: see [Data](../../fundamentals/data/). The suite above needs none.
- `Request::fromArray()` builds a real request with no global state, so there is nothing to mock.

See also [Middleware](../../fundamentals/middleware/), [Sessions](../../fundamentals/sessions/) and [HTTP](../../fundamentals/http/).
