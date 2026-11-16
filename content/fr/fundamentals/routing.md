---
title: Routage
order: 3
description: Déclarez des routes avec des attributs sur les méthodes de contrôleur, contraignez les paramètres, attachez des middlewares, générez des URL et mettez la table de routes en cache.
---

# Routage

Un chemin direct vers votre logique.

Zephyrus déclare les routes avec des attributs PHP sur les méthodes de contrôleur, et un `Router` les collecte. Le routeur est immuable : chaque méthode retourne un nouveau routeur, alors conservez la valeur retournée. Sous PHP 8.5 et plus récent, PHP avertit quand le résultat d’une méthode `with*()` est ignoré, comme `$router->withTrailingSlashTolerance();` seul (`#[\NoDiscard]`) ; `get()`, `post()` et `discoverControllers()` n’avertissent pas, vérifiez-les donc vous-même.

## Votre première route

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

`$root` est le répertoire de base de l’application, transmis par le code d’amorçage présenté dans la page [application](../application/). Les extraits ci-dessous construisent `$router` à partir de celui-ci.

Indiquez au routeur où se trouvent vos contrôleurs :

```php
use Zephyrus\Routing\Router;

$router = (new Router())->discoverControllers('App\\Controllers', $root . '/app/Controllers');
```

`discoverControllers()` parcourt le répertoire, charge chaque classe concrète dont le nom correspond à l’espace de noms et enregistre les routes qu’elle déclare. Le routeur est ensuite remis au builder de l’application avec `withRouter($router)` (voir [Application](../application/)). Avec une section `router:` dans `config.yml`, vous n’écrivez rien de tout cela : voir [La section router](#la-section-router).

## Attributs de méthode

Chaque méthode HTTP a son attribut dans `Zephyrus\Routing\Attribute` : `Get`, `Post`, `Put`, `Patch`, `Delete`, `Head` et `Options`. Ils acceptent tous un chemin, puis des arguments facultatifs `constraints`, `middlewares` et `name`.

```php
#[Put('/thing')]
#[Patch('/thing')]
public function change(): Response
{
    return $this->text('changed');
}
```

Les attributs sont répétables, donc une méthode peut répondre à plusieurs verbes ou à plusieurs chemins. `Route` est la forme générique, avec la méthode comme second argument :

```php
#[Route('/multi', 'GET')]
#[Route('/multi-alias', 'GET')]
public function multi(): Response
{
    return $this->text('multi');
}
```

Seules les méthodes publiques déclarées par la classe du contrôleur elle-même sont lues. Un attribut de route placé sur une méthode d’une classe parente n’enregistre rien pour la sous-classe.

## Préfixes avec Root

`#[Root]` préfixe toutes les routes d’une classe. Le préfixe de la classe parente vient en premier, puis celui de la classe elle-même.

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

`GET /api/projects` et `GET /api/projects/` atteignent tous deux `index()`.

## Paramètres de route

Un paramètre substituable est un segment de chemin complet entre accolades. Le gestionnaire le reçoit par son nom, converti vers le type que vous déclarez.

```php
#[Get('/{id}', constraints: ['id' => '\d+'], name: 'projects.show')]
public function show(int $id, int $userId): Response
{
    return $this->json(['id' => $id, 'viewer' => $userId]);
}
```

Une contrainte est un fragment d’expression régulière. Sans contrainte, un paramètre correspond à `[^/]+`. Contraignez chaque paramètre que vous pouvez : une requête qui ne satisfait pas la contrainte, ou dont la valeur ne peut pas être convertie vers le type déclaré, reçoit un 404.

Les paramètres du gestionnaire sont résolus dans cet ordre :

1. un paramètre typé `Request` reçoit la requête ;
2. un paramètre nommé comme un paramètre substituable de la route trouvée prend la valeur de l’URL ;
3. un paramètre nommé comme un attribut de la requête prend cet attribut, converti vers son type (ici `$userId`, défini par un middleware) ;
4. tout autre paramètre prend le prochain paramètre substituable non encore réclamé, selon sa position ;
5. sinon, sa valeur par défaut est utilisée, et sans valeur par défaut l’appel échoue.

Nommez vos paramètres comme les paramètres substituables : le repli positionnel existe, mais il se lit facilement de travers. La chaîne de requête ne se lie jamais : `?n=3` laisse `int $n = 5` à 5. Lisez-la avec `$request->query()` (voir [HTTP](../http/)).

Une route statique l’emporte sur une route paramétrée, peu importe l’ordre d’enregistrement : `/users/me` gagne sur `/users/{id}`. Parmi les routes paramétrées, l’ordre d’enregistrement tranche.

### Contraindre la forme d’un segment

Un paramètre substituable remplit un segment entier et ne peut pas le partager avec du texte. Pour faire correspondre `report.json`, capturez le segment et contraignez-le :

```php
#[Get('/files/{file}', constraints: ['file' => '[a-z]+\.json'])]
```

## Nommer les routes

L’argument `name` donne un nom à une route pour la [génération d’URL](#générer-des-url). Les noms doivent être uniques. Deux routes par attribut d’une même classe qui partagent un nom sont refusées (`Duplicate route name "same" discovered while reading attributes on class "Dup\A".`). Entre classes, ou avec des routes enregistrées sur le routeur, le doublon est refusé à la construction de l’application : `ApplicationBuilder::build()` lance une `Zephyrus\Routing\Exception\DuplicateRouteNameException` (`Duplicate route names detected: same`). La version 0.14.1 acceptait un doublon entre classes, `route()` prenant la première, jusqu’à l’appel de `$router->assertNoDuplicateRouteNames()`, qui lançait alors une `RouteSignatureException` : un `catch` sur cette classe ne l’attrape plus.

## Attacher des middlewares

`#[Middleware('auth')]` désigne un middleware enregistré sur le builder, sur une classe ou sur une méthode. Les routes l’exécutent alors après le middleware global, dans l’ordre décrit dans [Middleware](../middleware/).

```php
#[Root('/api/projects')]
#[Middleware('auth')]
final class ProjectController extends Controller
{
    // every route here runs the "auth" middleware
}
```

Sur une classe, l’attribut est hérité par les sous-classes et s’exécute en commençant par le parent. Sur une méthode, chaque `#[Middleware]` s’exécute avant chaque `#[MiddlewareGroup]`. Une route peut aussi lister des noms directement : `#[Get('/', middlewares: ['auth'])]`.

Un groupe est un nom pour une liste de noms de middlewares. Définissez-le sur le routeur avant les routes qui l’utilisent :

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

### Ignorer un middleware global

`#[WithoutMiddleware]` sur une classe ou une méthode ignore un middleware global pour les routes visées : un webhook sans état qui n’a pas besoin de session, une sonde de santé.

```php
use Zephyrus\Session\SessionMiddleware;

#[Get('/health')]
#[WithoutMiddleware(SessionMiddleware::class)]
public function health(): Response
{
    return $this->json(['ok' => true]);
}
```

Seule une route trouvée peut ignorer un middleware : un 404 ou un 405 exécute tout de même chaque middleware global. Les middlewares de route définis avec `#[Middleware]` ne sont jamais ignorés. Les middlewares de sécurité du framework (redirection HTTPS, hôtes autorisés, CSRF, limite de taille du corps, en-têtes sécurisés, CSP) ne peuvent pas être ignorés : la route est refusée à l’enregistrement (voir [les refus](#refus-à-la-construction)).

## Une base de code, plusieurs processus

`#[RequiresEnv]` n’enregistre une classe ou une méthode que lorsqu’une variable d’environnement a exactement cette valeur (sensible à la casse) :

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

Si `MODE` n’est pas défini, `GET /v1/status` n’est pas enregistrée et répond 404. Un contrôleur sans `#[RequiresEnv]` s’enregistre dans tous les processus. L’attribut est hérité par les sous-classes, vous pouvez donc le placer sur une classe de base abstraite.

## Enregistrer sans attributs

Tout ce que font les attributs est disponible sur le routeur. Un gestionnaire est une chaîne `Class@method` :

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

- `get()`, `post()`, `put()`, `patch()`, `delete()`, `head()` et `options()` acceptent un chemin, un gestionnaire, des contraintes et des noms de middlewares ; `add()` prend la méthode en premier.
- `name()` nomme la route qui vient d’être ajoutée. `withoutMiddleware()` fait de même pour un middleware global ignoré.
- `group()` ajoute un préfixe, des middlewares partagés, un préfixe de nom et `excludedMiddlewares` à chaque route de la fonction de rappel.
- `resource()` enregistre les six routes conventionnelles (`index`, `show`, `store`, `update`, `patch`, `delete`), avec `{id}` limité aux chiffres.
- `controller(ProjectController::class)` enregistre les attributs d’une seule classe ; `discoverControllers()` accepte un troisième argument facultatif, `parentClass:`, pour n’enregistrer que les sous-classes d’une classe de base.

Une fermeture n’est pas un gestionnaire : c’est la forme en chaîne qui rend la table de routes mettable en cache.

## Générer des URL

Donnez un nom à une route, puis construisez son URL plutôt que de l’écrire à la main :

```php
use Zephyrus\Core\App;
use Zephyrus\Routing\RouteUrlGenerator;

App::setUrlGenerator(new RouteUrlGenerator($router->routes(), 'https://app.example.test'));

route('projects.show', ['id' => 12], ['tab' => 'files']);
// https://app.example.test/api/projects/12?tab=files
```

`route()` est disponible en PHP et dans Latte dès qu’un générateur est défini ; sans URL de base, elle retourne le chemin seul. Les valeurs des paramètres substituables sont encodées en pourcentage, les clés de la chaîne de requête sont triées, et un cinquième argument facultatif de `generate()` ajoute un fragment. Vous pouvez aussi utiliser directement le générateur :

```php
$urls = new RouteUrlGenerator($router->routes(), 'https://app.example.test');

$urls->generate('reports.show', ['id' => 12], ['tab' => 'files', 'a' => 'b c'], 'top');
// https://app.example.test/reports/12?a=b%20c&tab=files#top
```

`generate()` lance `RouteUrlGenerationException` pour un nom inconnu, un paramètre manquant ou inattendu, ou une valeur qui enfreint la contrainte de la route (par exemple `Route parameter "id" for route "reports.show": value "x" does not satisfy constraint "\d+"`).

### URL signées

Passez un `RouteSignature` construit avec un secret tiré de l’environnement pour signer les URL, afin qu’un lien ne puisse pas être modifié :

```php
use Zephyrus\Routing\RouteSignature;

$signature = new RouteSignature($_ENV['LINK_SIGNING_SECRET']);
$urls = new RouteUrlGenerator($router->routes(), 'https://app.example.test', $signature);

$urls->generateSigned('reports.show', ['id' => 12]);
$urls->generateTemporarySigned('reports.show', 3600, ['id' => 12]); // expires in an hour
```

Quand le lien revient, vérifiez-le avec `$signature->verify($url)` (un booléen) ou `$signature->assertValid($url)` (lance `RouteSignatureException` : `Invalid route signature` ou `Route signature has expired`). Un secret vide est refusé. Vérifiez avec l’URL complète telle que le navigateur l’a demandée, et utilisez un secret long et aléatoire.

## 404 et 405

Un chemin inconnu répond 404. Un chemin connu avec la mauvaise méthode répond 405 avec un en-tête `Allow` qui liste les méthodes acceptées. Une route `GET` répond aussi à `HEAD`. Une barre oblique finale est tolérée ; appelez `$router->strictTrailingSlashes()` pour distinguer `/users` et `/users/`.

```php
#[Get('/lookup/{id}', constraints: ['id' => '\d+'])]
public function show(int $id): Response
{
    $name = self::PROJECTS[$id] ?? throw new RouteNotFoundException('project');

    return $this->text($name);
}
```

`RouteNotFoundException` lancée depuis le code d’un gestionnaire répond 404 comme une route inconnue, de sorte qu’un enregistrement manquant ne demande aucun traitement particulier. `$this->abort(404)` fait la même chose sans exception. Un chemin qui n’est pas de l’UTF-8 valide ou qui contient un caractère de contrôle est aussi un 404. Le middleware global s’exécute sur les réponses 404 et 405, qui portent donc vos en-têtes de sécurité.

## La section router

Au lieu d’appeler `discoverControllers()` dans le code, déclarez les contrôleurs dans `config.yml` :

```yaml
router:
  controllers:                      # required: PSR-4 namespace => directory
    App\Controllers: app/Controllers
  middleware_groups:                # optional: name => middleware or group names
    admin: [auth, audit]
  cache: var/zephyrus/routes.php    # optional, this is the default
```

Le builder fait le reste : lorsque la configuration déclare `router:` et qu’il n’y a pas de `withRouter()`, `build()` construit le routeur à partir de la section.

```php
$app = ApplicationBuilder::buildFromConfigurationFile($root . '/config.yml');
```

- Les chemins relatifs se résolvent à partir du `basePath` (le répertoire du fichier avec `fromConfigurationFile()` et `buildFromConfigurationFile()`), jamais du répertoire courant. `cache` doit être un fichier `.php` sous cette racine.
- Aucune valeur ne peut porter une balise YAML, `!env` comprise. Un répertoire de contrôleurs absent, ou qui ne contient aucune classe de son espace de noms, est refusé, là où `discoverControllers()` n’enregistre rien en silence.
- Écrivez l’espace de noms nu ou entre apostrophes : entre guillemets doubles, `"App\Controllers"` est une erreur d’échappement YAML.
- Déclarez les groupes sous `router.middleware_groups` plutôt qu’en appelant `Router::middlewareGroup()`.
- `Router::fromConfiguration($config, basePath: $root)` construit le même routeur lorsqu’il vous le faut avant `build()` ; passez-le à `withRouter()`. Tout autre routeur donné à `withRouter()` est refusé lorsque la configuration déclare `router:`, afin qu’une migration à moitié faite n’écrive pas un cache que personne ne lit :

```text
Configuration declares router.controllers, but withRouter() received a router that Router::fromConfiguration() did not build, so the routes cache would never be read. Remove the withRouter() call to let build() discover the controllers, or start the router passed to it from Router::fromConfiguration($configuration, basePath: <application root>).
```

Sans section `router:`, rien ne change : `discoverControllers()` et `withRouter()` continuent de fonctionner et découvrent les contrôleurs à chaque requête.

## Le cache des routes

En production et en staging, `Router::fromConfiguration()` lit `var/zephyrus/routes.php`, le fichier qu’écrit `vendor/bin/zephyrus cache:warm`, au lieu de parcourir les contrôleurs et de les analyser par réflexion. En développement et en test, il les découvre toujours. Lorsque le cache est absent, périmé ou refusé, ou que `basePath` ne contient pas de `config.yml`, le routeur se rabat sur la découverte et journalise une ligne, par exemple :

```text
Zephyrus: no routes cache at /var/www/html/var/zephyrus/routes.php, so the controllers were discovered for this request. Run vendor/bin/zephyrus cache:warm to write it.
```

- Le cache est périmé dès que `config.yml`, un fichier sous un répertoire de contrôleurs, ou le fichier d’une classe parente, d’un trait ou d’une interface d’un contrôleur change (à la seconde près). Une constante d’une autre classe lue par un attribut n’est pas suivie : lancez `cache:warm` à chaque build.
- `#[RequiresEnv]` est évalué à chaque requête : un seul cache sert donc tous les `MODE` et `APP_ENV`.
- Le cache contient en clair le chemin, le nom et les contraintes de chaque route : ne construisez jamais une route à partir d’un secret.
- Deux routes de même nom qui peuvent être enregistrées ensemble sont refusées, par le réchauffage et par la découverte en développement.

L’écriture des caches relève de la construction de l’image : voir [Caches et déploiement](../configuration/#caches-et-déploiement). Sur une application d’environ 340 routes avec OPcache, la lecture du cache fait passer les routes de 6-8 ms à 1,3-1,6 ms par requête.

La version 0.15.0 exposait `RouteCache` (`new RouteCache($file)`, `has()`, `load()`, `save()`, `warm()`, `warmIfStale()`, `isFresh()`, `inspect()` et le reste) et vous laissait écrire et lire un fichier JSON. Cette API a disparu : `RouteCache` est interne, et un cache est jugé d’après ce dont il a été lu, non d’après son âge. Supprimez le code qui réchauffe ou inspecte un `RouteCache`, ajoutez la section `router:` et lancez `vendor/bin/zephyrus cache:warm`.

## Refus à la construction

Le routeur refuse une route qu’il ne peut pas servir correctement, à l’enregistrement, de sorte qu’une erreur échoue au démarrage et non dans le trafic de production.

Une route qui désigne un middleware ou un groupe jamais enregistré est refusée à la construction de l’application :

```text
Route middlewares are not registered: "admin" on GET /misc/admin, "auth" on 5 routes (GET /api/projects, GET /api/projects/{id}, GET /api/projects/{id}/files/{name}, ...); no middleware is registered. Register each with registerMiddleware() before build(), or, for a group, define it with Router::middlewareGroup() before the routes that name it.
```

Refus de chemin (`RouteSignatureException`) :

```text
Invalid route path "/a?x=1": the request path ends at "?", so this route would only match "/a"; declare "/a" and read the query string from the request
Invalid route parameter name "id?" on route "/a/{id?}": optional placeholders are not supported; declare a second route without that segment
Invalid route parameter name "1x" on route "/a/{1x}": a placeholder must match /^[A-Za-z_][A-Za-z0-9_]*$/D
Duplicate route parameter name "id" on route "/a/{id}/{id}": only the last occurrence would survive, so the earlier segment would match unchecked
Invalid route path "/a/{id}.json": segment "{id}.json" mixes a placeholder with text; capture the whole segment with a constraint or give the placeholder its own segment
Reserved route parameter name "_zephyrus_x" on route "/a/{_zephyrus_x}": the framework publishes this attribute itself, so a URL segment must not be able to supply it
```

Refus de middleware (`RouteMiddlewareException`) :

```text
Route "GET /a" cannot skip "Zephyrus\Security\CsrfMiddleware": it is a framework security middleware. Exempt the path under security.csrf.exceptions instead
Circular middleware group reference detected: a -> b -> a
```

## Bon à savoir

- Le routeur est immuable. `$router->get(...)` seul sur sa ligne n’enregistre rien ; réassignez-le ou chaînez les appels.
- `discoverControllers()` n’enregistre rien, silencieusement, lorsque le répertoire ou l’espace de noms est erroné : un répertoire absent retourne le routeur inchangé et une classe qui ne correspond pas à l’espace de noms est ignorée. Vérifiez `$router->count()` pendant la mise en place, ou utilisez la section `router:`, qui refuse les deux.
- Les attributs de route sur les méthodes d’une classe parente ne s’appliquent pas aux sous-classes ; `#[Root]`, `#[Middleware]` et `#[RequiresEnv]` sur la classe parente, eux, s’appliquent.
- Déclarez les groupes de middlewares avant `discoverControllers()` : un groupe est développé lors de l’ajout d’une route. Avec la section `router:`, déclarez-les sous `router.middleware_groups`.
- Deux routes par attribut d’une même classe qui partagent un nom sont refusées à l’enregistrement de la classe ; tout autre doublon arrête `build()` avec `DuplicateRouteNameException`.
- Un `POST` portant un champ `_method` ou un en-tête `X-HTTP-Method-Override` valant `PUT`, `PATCH` ou `DELETE` est routé comme cette méthode lorsque la requête provient de `Request::fromGlobals()`.
