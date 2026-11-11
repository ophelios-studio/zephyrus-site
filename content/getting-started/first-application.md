---
title: First application
order: 4
description: Build a small notes application with a form, validation, CSRF protection, a flash message and a test, without a database.
---

# First application

A form, a list and a test, end to end.

You build a page that lists notes kept in the session, with a form that adds one. It uses the pieces most applications need: a controller, a Latte layout, CSRF protection, validation, a flash message and a redirect after the form is posted. There is no database.

Start from an empty directory and the `composer.json` of the [installation](../installation/) page, with PHPUnit added:

```bash
composer require --dev phpunit/phpunit
```

Add `"autoload-dev": { "psr-4": { "Tests\\": "tests/" } }` to `composer.json` and run `composer dump-autoload`.

## Configure

Declare what the application promises. Each `security` key is enforced by a middleware you mount in the next step, and `build()` refuses to boot if one is missing.

```yaml
application:
  environment: !env APP_ENV, dev
  debug: !env APP_DEBUG, false

session:
  name: NOTES_SESSION
  same_site: Lax

security:
  max_body_size: 1048576
  csrf:
    enabled: true
  headers:
    x_frame_options: DENY
    referrer_policy: same-origin

localization:
  locale: en
  timezone: UTC
```

`debug` defaults to off. The session cookie is named `NOTES_SESSION` and is `SameSite=Lax`. See [Configuration](../../fundamentals/configuration/).

## Bootstrap

The bootstrap class builds the application and mounts the middleware, in order. The first one added runs outermost.

```php
<?php

declare(strict_types=1);

namespace App;

use Zephyrus\Core\Application;
use Zephyrus\Core\ApplicationBuilder;
use Zephyrus\Core\Config\Configuration;
use Zephyrus\Http\Request;
use Zephyrus\Rendering\LatteEngine;
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

        // fromGlobals() does not read config.yml: pass the proxy settings yourself.
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

        $views = new LatteEngine($root . '/app/Views', $root . '/cache/latte');
        $views->getLatteEngine()->addFunction('csrfToken', $tokens->getToken(...));

        $router = (new Router())->discoverControllers('App\\Controllers', $root . '/app/Controllers');

        // The first middleware added runs outermost. Each declared security key
        // (headers, max_body_size, csrf) must be enforced here or build() throws.
        return ApplicationBuilder::create()
            ->withConfiguration($config, basePath: $root)
            ->withRouter($router)
            ->withRenderEngine($views)
            ->withMiddleware(new SecureHeadersMiddleware($config->security->headers))
            ->withMiddleware(new MaxBodySizeMiddleware($config->security->maxBodySize))
            ->withMiddleware(new SessionMiddleware($config->session, $session))
            ->withMiddleware(new CsrfMiddleware($tokens, CsrfConfig::fromSecurityConfig($config->security)))
            ->build();
    }
}
```

```php
<?php

declare(strict_types=1);

require dirname(__DIR__) . '/vendor/autoload.php';

App\Kernel::run(dirname(__DIR__));
```

- `SecureHeadersMiddleware` adds the security headers declared under `security.headers`.
- `MaxBodySizeMiddleware` refuses request bodies over `security.max_body_size`.
- `SessionMiddleware` starts the session for the request. It comes before CSRF, which stores its token there.
- `CsrfMiddleware` refuses a state-changing request that does not carry the token. The view calls `csrfToken()` to render it.

Details are in [Application](../../fundamentals/application/), [Middleware](../../fundamentals/middleware/) and [Security](../../fundamentals/security/).

## The controller

```php
<?php

declare(strict_types=1);

namespace App\Controllers;

use Zephyrus\Controller\Controller;
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Rendering\RenderResponses;
use Zephyrus\Routing\Attribute\Get;
use Zephyrus\Routing\Attribute\Post;
use Zephyrus\Session\Flash;
use Zephyrus\Validation\FormValidator;
use Zephyrus\Validation\Rules;

final class NoteController extends Controller
{
    use RenderResponses;

    #[Get('/')]
    public function index(): Response
    {
        return $this->renderPage();
    }

    #[Post('/notes')]
    public function add(Request $request): Response
    {
        $form = new FormValidator([
            'text' => [Rules::required(), Rules::notBlank(), Rules::maxLength(120)],
        ]);
        $errors = $form->validate($request->body()->all());

        if ($errors->hasErrors()) {
            return $this->renderPage($errors->allMessages(), 422);
        }

        $notes = session('notes', []);
        $notes[] = trim((string) $request->body()->get('text'));
        session(['notes' => $notes]);
        Flash::success('Note added.');

        return $this->redirect('/');
    }

    /**
     * @param list<string> $errors
     */
    private function renderPage(array $errors = [], int $status = 200): Response
    {
        return $this->render('notes', [
            'notes' => session('notes', []),
            'errors' => $errors,
            'flash' => Flash::readAll(),
        ], $status);
    }
}
```

- `#[Get('/')]` and `#[Post('/notes')]` register the routes (see [Routing](../../fundamentals/routing/)).
- `FormValidator` and `Rules` check the input (see [Validation](../../fundamentals/validation/)). `Rules::required()` accepts a string of spaces, so `notBlank()` is added.
- On errors the page is rendered again with a `422` status and the messages. On success the note is stored with `session()`, a flash message is queued, and the response is a redirect: a browser that reloads the page does not post the form again.
- `Flash::readAll()` reads the queued messages and clears them. See [Sessions](../../fundamentals/sessions/).

The note text is trimmed before it is stored, and it is escaped when displayed.

## The views

`app/Views/layout.latte` holds the page frame:

```latte
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{block title}Notes{/block}</title>
</head>
<body>
    <main>
        {block content}{/block}
    </main>
</body>
</html>
```

`app/Views/notes.latte` fills it:

```latte
{layout 'layout.latte'}

{block title}My notes{/block}

{block content}
    <h1>My notes</h1>

    {foreach $flash->success as $message}
        <p role="status">{$message}</p>
    {/foreach}

    {foreach $errors as $error}
        <p role="alert">{$error}</p>
    {/foreach}

    <ul>
        {foreach $notes as $note}
            <li>{$note}</li>
        {else}
            <li>No notes yet.</li>
        {/foreach}
    </ul>

    <form method="post" action="/notes">
        <input type="hidden" name="_csrf_token" value="{csrfToken()}">
        <label>Note <input name="text" maxlength="120" required></label>
        <button>Add</button>
    </form>
{/block}
```

Latte escapes `{$note}` and every other output. There is no automatic token injection: the form carries the CSRF field itself. See [Views](../../fundamentals/views/).

## Run it

```bash
php -S 127.0.0.1:8000 -t public
```

Open `http://127.0.0.1:8000/`, add a note, and the page redirects to the list with "Note added." shown once. Posting the form without the token is refused:

```bash
curl -i -d "text=Milk" http://127.0.0.1:8000/notes
```

```text
HTTP/1.1 403 Forbidden
```

## Test it

`Application::handle()` turns a `Request` into a `Response` in process, so a test needs no server.

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

final class NotesTest extends TestCase
{
    private static Application $app;

    public static function setUpBeforeClass(): void
    {
        $root = dirname(__DIR__);
        self::$app = Kernel::application($root, Configuration::fromYamlFile($root . '/config.yml'));
    }

    protected function tearDown(): void
    {
        $_SESSION = [];
        App::reset();
    }

    public function testAnAddedNoteIsListedAfterTheRedirect(): void
    {
        $page = self::$app->handle(Request::fromArray('GET', '/'));
        preg_match('/name="_csrf_token" value="([0-9a-f]+)"/', $page->body, $found);

        $added = self::$app->handle(Request::fromArray('POST', '/notes', body: ['text' => 'Milk', '_csrf_token' => $found[1]]));
        $list = self::$app->handle(Request::fromArray('GET', '/'));

        self::assertSame(302, $added->status);
        self::assertSame('/', $added->getHeader('Location'));
        self::assertStringContainsString('<li>Milk</li>', $list->body);
        self::assertStringContainsString('Note added.', $list->body);
    }

    public function testAPostWithoutTheTokenIsRefused(): void
    {
        $response = self::$app->handle(Request::fromArray('POST', '/notes', body: ['text' => 'Milk']));

        self::assertSame(403, $response->status);
    }
}
```

```bash
vendor/bin/phpunit
```

```text
OK (2 tests, 5 assertions)
```

The test reads the token from the rendered form, as a browser would, then posts it. `$_SESSION = []` in `tearDown()` matters: in process there is no cookie, and the PHP session lives for the whole process, so a note added by one test would show in the next. The [testing](../../digging-deeper/testing/) page goes further.

## Where to go next

- [Routing](../../fundamentals/routing/) and [Controllers](../../fundamentals/controllers/): parameters, groups and responses.
- [Data](../../fundamentals/data/): replace the session with PostgreSQL.
- [Errors](../../fundamentals/errors/): what the client sees when something fails.
