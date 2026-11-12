---
title: Tests
order: 8
description: Testez une application en processus avec PHPUnit en envoyant des requêtes par Application::handle(), avec CSRF, sessions, points d’accès JSON et middlewares.
---

# Tests

Sans serveur, sans navigateur, de vraies requêtes.

`Application::handle()` transforme une `Request` en une `Response` sans serveur web : un test exerce donc ensemble le routage, les middlewares, le contrôleur et la vue de votre application. Les exemples ont été vérifiés sur PHPUnit 13 et utilisent l’application de la page [première application](../../getting-started/first-application/) ainsi qu’un petit point d’accès JSON.

Installez PHPUnit et associez l’espace de noms des tests :

```bash
composer require --dev phpunit/phpunit
```

```json
"autoload-dev": { "psr-4": { "Tests\\": "tests/" } }
```

`phpunit.xml` :

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

Exécutez la suite avec `vendor/bin/phpunit`. Traiter les avertissements et les tests risqués comme des échecs garde la suite honnête.

## Une classe de base

Construisez l’application dans `setUp()`, afin que chaque test parte d’un état propre. Cette classe de base le fait et ajoute trois aides :

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

- `Kernel::application()` est la méthode d’amorçage de la première application : elle retourne l’`Application` construite et n’envoie rien.
- `Request::fromArray()` construit une requête sans toucher aux variables globales de PHP. `body:` reçoit le corps déjà décodé.
- `App::reset()` efface les éléments statiques que conserve l’application (configuration, session, formateur, traducteur, le générateur d’URL derrière `route()`, etc.). Seul `build()` les réinstalle, ce qui explique pourquoi `setUp()` construit une nouvelle application pour chaque test.
- `$_SESSION = []` est une étape distincte et obligatoire, voir [Isoler les tests](#isoler-les-tests).

## Lire une réponse

Une `Response` a un `status`, un `body` et des en-têtes. Lisez les en-têtes avec `getHeader()`, qui ignore la casse : les noms d’en-têtes sont stockés en minuscules, de sorte que `$response->headers['Content-Type']` n’existe pas.

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

## Envoyer un formulaire

Une requête qui modifie l’état doit passer le middleware CSRF comme le ferait un navigateur. L’aide charge la page, lit le jeton dans le formulaire généré et le renvoie dans `_csrf_token`. C’est la session unique, partagée par tout le processus, qui explique pourquoi le jeton lu par un `GET` est valide pour le `POST` suivant.

Une requête sans le jeton est refusée avec `403` : vérifiez-le aussi, afin qu’on remarque le retrait du middleware.

## Conserver une session entre deux requêtes

En processus, il n’y a aucun témoin à transporter : la session est la même pour toutes les requêtes jusqu’à ce que vous l’effaciez. `testAnAddedNoteIsListedAfterTheRedirect()` ci-dessus publie une note, puis demande la liste et y trouve la note, sans rien d’autre à préparer. Le message éclair n’est affiché que lors de cette seconde requête.

## Un point d’accès JSON

Le point d’accès de cette classe de test se trouve dans `app/Controllers/ApiController.php`, derrière un middleware `require-json` (présenté plus bas). Un client JSON envoie le jeton dans l’en-tête `X-CSRF-Token` ainsi qu’un en-tête `Accept`.

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

`Request::fromArray()` reçoit le corps décodé dans `body:` et ne décode pas un `rawBody:` JSON. Passez le tableau qu’un client aurait envoyé.

## Un middleware

Testez un middleware isolément en appelant `process()` avec une requête et une fermeture `$next`, puis une fois par une route pour vérifier qu’il est monté. Voici le middleware testé, enregistré dans l’amorçage avec `#[Middleware('require-json')]` sur le contrôleur. Le `Kernel` de la première application l’enregistre sur le constructeur, avant `build()` :

```php
->registerMiddleware('require-json', new RequireJson())
```

La classe :

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

Le second test passe un `$next` qui fait échouer le test s’il s’exécute : il prouve que la requête est arrêtée avant le contrôleur. Les tests au niveau des routes dans `ApiTest` prouvent l’enregistrement.

## Isoler les tests

Comme la session PHP vit pendant tout le processus et que `handle()` ne retourne aucun `Set-Cookie`, une note ajoutée par un test est toujours là pour le suivant. Sans `$_SESSION = []` dans `tearDown()`, un test réussit ou échoue selon l’ordre dans lequel les autres ont été exécutés. Exécutez la suite en ordre aléatoire pour le détecter :

```bash
vendor/bin/phpunit --order-by=random
```

Avec la ligne retirée de la classe de base ci-dessus, cette suite a échoué à chaque ordre aléatoire essayé. Avec elle, elle a réussi à chacun.

## Bon à savoir

- Vérifiez le statut et le corps qu’un client verrait (`403`, `404`, `405`, `422`), jamais une trace ni un message d’exception.
- Un test qui a besoin de PostgreSQL exige une vraie base de données : voyez [Données](../../fundamentals/data/). La suite ci-dessus n’en exige aucune.
- `Request::fromArray()` construit une vraie requête sans état global : il n’y a donc rien à simuler.

Voyez aussi [Middleware](../../fundamentals/middleware/), [Sessions](../../fundamentals/sessions/) et [HTTP](../../fundamentals/http/).
