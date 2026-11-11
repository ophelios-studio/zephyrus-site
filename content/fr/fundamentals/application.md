---
title: L'application
order: 2
description: Comment ApplicationBuilder assemble une Application à partir d'une configuration, d'un routeur et de middlewares, et comment une requête traverse HttpKernel.
---

# L'application

Un builder, un `handle()`.

Une application Zephyrus est un objet qui transforme une `Request` en `Response`. Vous l'assemblez avec `ApplicationBuilder`, puis vous envoyez sa réponse au navigateur ou, dans les tests, vous la lisez. Il n'y a pas de contrôleur frontal du framework à étendre : le code de liaison est une petite classe qui vous appartient.

## Une classe de démarrage

Voici un démarrage complet. `public/index.php` l'appelle, et vos tests appellent directement `application()`.

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

`Request::fromGlobals()` ne lit pas `config.yml` : transmettez vous-même les réglages de proxy, comme ci-dessus. Le fichier `.env` n'est pas lu non plus, voir [Configuration](../configuration/#environment-variables).

## Le builder

`ApplicationBuilder` est immuable : chaque méthode `with*()` retourne un nouveau builder. Un appel dont vous ignorez le résultat ne monte rien : enchaînez donc les appels ou réassignez (`$builder = $builder->withMiddleware(...)`). `build()` retourne l'`Application`.

| Méthode | Ce qu'elle câble |
| --- | --- |
| `withConfiguration($config, basePath: $root)` | La configuration : la localisation (un `locale_path` relatif est résolu à partir de `basePath`). `build()` applique `application.debug` et `localization.timezone` |
| `withRouter($router)` | Le routeur. Sans routeur, chaque requête reçoit un 404 |
| `withMiddleware($m)` | Un middleware global : il s'exécute à chaque requête, y compris les 404 et 405, le premier ajouté étant le plus à l'extérieur |
| `registerMiddleware('name', $m)` | Donne à un middleware un nom que les routes peuvent référencer. Il ne s'exécute que sur ces routes |
| `withContainer($container)` | Construit les contrôleurs au moyen du conteneur |
| `withControllerFactory($callable)` | Construit les contrôleurs avec votre propre `callable(class-string): object` |
| `withRenderEngine($engine)` | Partage un moteur de vues avec tous les contrôleurs qui utilisent `RenderResponses` |
| `withEventDispatcher($events)` | Le répartiteur qui reçoit les événements du noyau. Sans lui, aucun événement n'est émis |
| `withExceptionHandler($class, $callable)` | Associe une classe d'exception à une réponse : voir [Erreurs](../errors/) |
| `withDebugClientAllowlist(...)`, `withProductionDebugAcknowledged()` | Qui peut voir le débogueur : voir [Erreurs](../errors/) |
| `withAcknowledgedSecurityKeys([...])`, `withoutSecurityWiringCheck()` | La vérification de sécurité au démarrage : voir [Sécurité](../security/) |

La localisation a ses propres points d'entrée : `withLocalizationConfig()`, `withJsonLocales($path)`, `withJsonLocaleLayers($paths)`, `withFallbackLoaders($loaders)`, `withLocaleLoader($loader)` et `withSupportedLocales($locales)`. Voir [Localisation](../localization/).

Vous pouvez aussi partir d'une configuration au lieu de l'ajouter ensuite : `ApplicationBuilder::fromConfiguration($config)`, `fromConfigurationFile($path)`, `fromConfigurationArray($array)`, `fromConfigurationFiles($paths)`, `fromOptionalConfigurationFiles($paths)` (les fichiers manquants sont ignorés), ainsi que les variantes `buildFrom...()` qui retournent directement l'`Application`. `withConfigurationFile()`, `withConfigurationFiles()`, `withOptionalConfigurationFiles()` et `withConfigurationArray()` font la même chose sur un builder existant.

### Découvrir les contrôleurs

`Router::discoverControllers($namespace, $directory)` enregistre chaque classe du répertoire dont les attributs déclarent une route. L'espace de noms est le préfixe PSR-4 de ce répertoire, et le répertoire est un chemin absolu. Un répertoire inexistant, ou un espace de noms qui ne correspond pas, n'enregistre rien et ne lève aucune erreur : si une route répond 404, vérifiez d'abord ces deux arguments. Voir [Routage](../routing/) et [Contrôleurs](../controllers/).

### Des contrôleurs construits par le conteneur

`withContainer()` résout chaque contrôleur au moyen d'un [conteneur](../../digging-deeper/container-and-events/), de sorte que les dépendances du constructeur sont injectées :

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

Une classe pour laquelle le conteneur n'a aucune liaison est construite par câblage automatique de son constructeur typé. `withControllerFactory()` et `withContainer()` définissent le même point d'accroche : le dernier appelé l'emporte. `withRenderEngine()` continue de fonctionner avec les deux.

### Middleware global ou nommé

Seul un middleware passé à `withMiddleware()` compte pour la vérification du câblage de sécurité. Un middleware enregistré par nom, ou enveloppé dans un autre middleware, n'est pas pris en compte. Voir [Middlewares](../middleware/) pour l'ordre d'exécution et les middlewares de route.

## Traiter une requête

`Application` est un objet en lecture seule qui n'a qu'une tâche :

```php
$response = $app->handle(Request::fromArray('GET', '/hello/ada'));

$response->status;           // 200
$response->body;             // {"message":"Hello, ada"}
```

En production, `Kernel::run()` se termine par `->send()`, qui écrit la ligne de statut, les en-têtes et le corps. Dans un test, vous gardez la `Response` et vous faites vos assertions dessus : aucun serveur n'est nécessaire.

```php
$app = Kernel::application($root, Configuration::fromYamlFile($root . '/config.yml'));
$response = $app->handle(Request::fromArray('GET', '/hello/ada'));
```

`Request::fromArray()` construit une requête à partir de valeurs simples (`body:`, `query:`, `headers:`, `cookies:`). `Request::fromGlobals()` en construit une à partir des superglobales PHP, et ne doit se trouver que dans `public/index.php`.

`Application` expose aussi le traducteur : `trans($key, $parameters, $locale)`, `transFromRequest(...)` et `resolveLocaleFromRequest(...)`. Voir [Localisation](../localization/).

### Le registre App

`build()` enregistre les services que lisent des fonctions utilitaires comme `config()`, `route()`, `localize()` et `format()` : la configuration, le traducteur, le formateur et le générateur d'URL. Ils vivent dans des propriétés statiques de `Zephyrus\Core\App` (`App::getConfiguration()`, `getTranslator()`, `getFormatter()`, `getUrlGenerator()`, `getSession()`, `getAsset()`, et les mutateurs correspondants), ainsi que `App::nonce()` pour le nonce de la Content-Security-Policy.

Cela suppose une seule requête par processus, comme le font php-fpm et mod_php. Les processus persistants (RoadRunner, Swoole, le mode worker de FrankenPHP) ne sont pas pris en charge : `App::reset()` vide le registre pour les tests, ce n'est pas un point d'accroche entre deux requêtes.

Un script en ligne de commande qui n'appelle jamais `build()` doit définir lui-même le formateur, sinon `format('decimal', 1234.5)` lève une exception :

```php
App::setFormatter(new Formatter('en_CA'));
```

## Le cycle de vie d'une requête

`HttpKernel` traite chaque requête dans le même ordre :

1. Un `RequestEvent` est émis. Un écouteur peut répondre de lui-même avec `setResponse()`, ce qui saute le routage.
2. Le routeur fait correspondre la requête. Les paramètres de la route sont connus avant l'exécution de tout middleware.
3. Les middlewares globaux s'exécutent, du plus externe au plus interne, autour de l'action de contrôleur trouvée. Pour un chemin inconnu ou une méthode incorrecte, ils s'exécutent plutôt autour de la réponse 404 ou 405.
4. Le contrôleur s'exécute (les middlewares de route l'enveloppent).
5. Un `ResponseEvent` est émis. Un écouteur peut remplacer la réponse.

Lorsque quelque chose lève une exception à l'étape 2, 3 ou 4, le noyau émet un `ExceptionEvent`, puis convertit l'exception en réponse (voir [Erreurs](../errors/)). La réponse d'erreur traverse tout de même les middlewares globaux : elle porte donc vos en-têtes de sécurité.

Trois réponses contournent les middlewares globaux : un court-circuit par `RequestEvent`, la réponse de secours utilisée lorsqu'un middleware global lève lui-même une exception, et une réponse remplacée par un écouteur de `ResponseEvent`. Un en-tête qui doit atteindre chaque réponse a aussi sa place dans le serveur web ou le proxy.

Les événements sont décrits dans [Conteneur et événements](../../digging-deeper/container-and-events/#kernel-events).

## La vérification du câblage de sécurité

Déclarer une clé sous `security:` est une promesse : `build()` refuse de démarrer si aucun middleware global ne l'applique. Voir [Sécurité](../security/) pour le tableau des clés et le middleware dont chacune a besoin.

```text
Configuration declares security settings that this application does not enforce as declared:
  - security.csrf is not enforced as declared: mount new Zephyrus\Security\CsrfMiddleware(...) globally with withMiddleware(), ...
```

### Bon à savoir

- Le premier middleware ajouté est le plus à l'extérieur. Placez `SecureHeadersMiddleware` en premier.
- `build()` définit le fuseau horaire par défaut et active ou désactive le débogueur. Les deux valent pour tout le processus.
- `withRenderEngine()` retourne un nouveau builder comme toutes les autres méthodes : `$builder->withRenderEngine($views);` seul ne fait rien.
- Les middlewares globaux s'exécutent aussi sur les réponses 404 et 405 : leurs effets de bord (démarrer une session, par exemple) s'y produisent donc aussi. Une route peut se soustraire à un middleware global avec `#[WithoutMiddleware]`.
