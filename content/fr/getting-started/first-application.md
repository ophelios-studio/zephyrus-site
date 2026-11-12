---
title: Première application
order: 4
description: Construire une petite application de notes avec un formulaire, la validation, la protection CSRF, un message flash et un test, sans base de données.
---

# Première application

Un formulaire, une liste et un test, de bout en bout.

Vous construisez une page qui liste des notes conservées dans la session, avec un formulaire qui en ajoute une. Elle utilise les éléments dont la plupart des applications ont besoin : un contrôleur, un gabarit Latte, la protection CSRF, la validation, un message flash et une redirection après l’envoi du formulaire. Il n’y a pas de base de données.

Partez d’un répertoire vide et du `composer.json` de la page d’[installation](../installation/), auquel vous ajoutez PHPUnit :

```bash
composer require --dev phpunit/phpunit
```

Ajoutez `"autoload-dev": { "psr-4": { "Tests\\": "tests/" } }` à `composer.json` et exécutez `composer dump-autoload`.

Créez `phpunit.xml` à la racine du projet :

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

## Configurer

Déclarez ce que l’application promet. Chaque clé `security` est appliquée par un middleware que vous montez à l’étape suivante, et `build()` refuse de démarrer s’il en manque un.

```yaml
application:
  environment: !env APP_ENV, production
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

L’environnement est `production` par défaut : un `APP_ENV` non défini ne signifie donc jamais le développement, et vous définissez `APP_ENV=dev` sur votre machine. `debug` est désactivé par défaut. Le témoin de session s’appelle `NOTES_SESSION` et est `SameSite=Lax`. Voir [Configuration](../../fundamentals/configuration/).

## Démarrage

La classe de démarrage, `app/Kernel.php`, construit l’application et monte les middlewares, dans l’ordre. Le premier ajouté est le plus à l’extérieur.

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

`public/index.php` l’appelle :

```php
<?php

declare(strict_types=1);

require dirname(__DIR__) . '/vendor/autoload.php';

App\Kernel::run(dirname(__DIR__));
```

- `SecureHeadersMiddleware` ajoute les en-têtes de sécurité déclarés sous `security.headers`.
- `MaxBodySizeMiddleware` refuse les corps de requête qui dépassent `security.max_body_size`.
- `SessionMiddleware` démarre la session pour la requête. Il précède le CSRF, qui y stocke son jeton.
- `CsrfMiddleware` refuse une requête qui modifie l’état et qui ne porte pas le jeton. La vue appelle `csrfToken()` pour l’afficher.

Les détails se trouvent dans [Application](../../fundamentals/application/), [Middlewares](../../fundamentals/middleware/) et [Sécurité](../../fundamentals/security/).

## Le contrôleur

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

- `#[Get('/')]` et `#[Post('/notes')]` enregistrent les routes (voir [Routage](../../fundamentals/routing/)).
- `FormValidator` et `Rules` vérifient les données saisies (voir [Validation](../../fundamentals/validation/)). `Rules::required()` accepte une chaîne d’espaces : `notBlank()` est donc ajouté.
- En cas d’erreurs, la page est affichée de nouveau avec le statut `422` et les messages. En cas de succès, la note est stockée avec `session()`, un message flash est mis en file, et la réponse est une redirection : un navigateur qui recharge la page n’envoie pas le formulaire une seconde fois.
- `Flash::readAll()` lit les messages en file et les efface. Voir [Sessions](../../fundamentals/sessions/).

Le texte de la note est nettoyé de ses espaces de bordure avant d’être stocké, et il est échappé à l’affichage.

## Les vues

`app/Views/layout.latte` contient le cadre de la page :

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

`app/Views/notes.latte` le remplit :

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

Latte échappe `{$note}` et toute autre sortie. Il n’y a aucune injection automatique du jeton : le formulaire porte lui-même le champ CSRF. Voir [Vues](../../fundamentals/views/).

## L’exécuter

```bash
APP_ENV=dev php -S 127.0.0.1:8000 -t public
```

Ouvrez `http://127.0.0.1:8000/`, ajoutez une note, et la page redirige vers la liste en affichant « Note added. » une seule fois. L’envoi du formulaire sans le jeton est refusé :

```bash
curl -i -d "text=Milk" http://127.0.0.1:8000/notes
```

```text
HTTP/1.1 403 Forbidden
```

## Le tester

`Application::handle()` transforme une `Request` en `Response` dans le processus, de sorte qu’un test n’a besoin d’aucun serveur.

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

    public function testAnAddedNoteIsListedAfterTheRedirect(): void
    {
        $page = $this->app->handle(Request::fromArray('GET', '/'));
        preg_match('/name="_csrf_token" value="([0-9a-f]+)"/', $page->body, $found);

        $added = $this->app->handle(Request::fromArray('POST', '/notes', body: ['text' => 'Milk', '_csrf_token' => $found[1]]));
        $list = $this->app->handle(Request::fromArray('GET', '/'));

        self::assertSame(302, $added->status);
        self::assertSame('/', $added->getHeader('Location'));
        self::assertStringContainsString('<li>Milk</li>', $list->body);
        self::assertStringContainsString('Note added.', $list->body);
    }

    public function testAPostWithoutTheTokenIsRefused(): void
    {
        $response = $this->app->handle(Request::fromArray('POST', '/notes', body: ['text' => 'Milk']));

        self::assertSame(403, $response->status);
    }
}
```

```bash
APP_ENV=dev vendor/bin/phpunit
```

```text
OK (2 tests, 5 assertions)
```

Le test lit le jeton dans le formulaire affiché, comme le ferait un navigateur, puis l’envoie. L’application est construite dans `setUp()`, de sorte que chaque test part d’une application neuve : `App::reset()` vide les propriétés statiques entre les tests et seul `build()` les installe de nouveau. `$_SESSION = []` dans `tearDown()` compte aussi : dans le processus, il n’y a pas de témoin, et la session PHP vit pendant toute la durée du processus, si bien qu’une note ajoutée par un test apparaîtrait dans le suivant. La page sur les [tests](../../digging-deeper/testing/) va plus loin.

## Pour aller plus loin

- [Routage](../../fundamentals/routing/) et [Contrôleurs](../../fundamentals/controllers/) : paramètres, groupes et réponses.
- [Données](../../fundamentals/data/) : remplacer la session par PostgreSQL.
- [Erreurs](../../fundamentals/errors/) : ce que le client voit lorsque quelque chose échoue.
