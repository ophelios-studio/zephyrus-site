---
title: Authentification
order: 10
description: Protégez vos routes avec des gardes et des middlewares nommés, et construisez une connexion et une déconnexion par session qui résistent à la fixation, à l’énumération et aux redirections ouvertes.
---

# Authentification

Vos utilisateurs, vos règles.

Zephyrus n’a ni modèle d’utilisateur, ni table de comptes, ni écran de connexion : qui sont vos utilisateurs et comment ils le prouvent relève de votre application. Le framework vous fournit plutôt les pièces faciles à mal faire :

- Les **gardes** décident si une requête peut continuer, et `AuthGuardMiddleware` transforme une garde en middleware que vous attachez à des routes.
- Les **sessions** avec renouvellement de l’identifiant, et les **jetons CSRF** que vous renouvelez à la connexion (voir [sessions](../sessions/) et [sécurité](../security/#protection-csrf)).
- Le **hachage des mots de passe** avec Argon2id, dans [Cryptographie](../../digging-deeper/cryptography/).

Cette page présente d’abord les gardes, puis une connexion par session complète construite avec ces pièces.

## Gardes

Une garde répond à une seule question à propos d’une requête :

```php
namespace Zephyrus\Security;

use Zephyrus\Http\Request;

interface AuthGuardInterface
{
    public function isAuthorized(Request $request): bool;
}
```

`AuthGuardMiddleware` exécute une garde et arrête la requête quand elle répond `false`. Par défaut, le refus est un 401 avec `{"error":"Unauthorized"}` ; les deuxième et troisième arguments changent le statut et le message :

```php
use Zephyrus\Security\AuthGuardMiddleware;
use Zephyrus\Security\RequestAttributeGuard;

new AuthGuardMiddleware($guard);                                                // 401 {"error":"Unauthorized"}
new AuthGuardMiddleware(new RequestAttributeGuard('role', ['admin']), 403, 'Forbidden'); // 403 {"error":"Forbidden"}
```

La réponse est toujours en JSON, ce qui convient à une API. Pour les pages qu’une personne visite, écrivez votre propre middleware qui redirige vers le formulaire de connexion, comme dans [identifier l’utilisateur](#identifier-lutilisateur) plus bas.

### Les gardes intégrées

**`HeaderTokenGuard`** compare un en-tête avec un jeton secret, en temps constant. Par défaut, elle lit `Authorization: Bearer <token>` :

```php
new HeaderTokenGuard($api->metricsToken);                  // Authorization: Bearer <token>
new HeaderTokenGuard($api->metricsToken, 'X-Api-Key', ''); // X-Api-Key: <token>, no prefix
```

Un en-tête absent ou vide est refusé, et toute requête l’est aussi quand le jeton attendu est vide : un secret non défini verrouille donc la route au lieu de l’ouvrir. Une valeur envoyée sans le préfixe `Bearer ` est comparée telle quelle.

**`IpAllowlistGuard`** laisse passer quand `$request->clientIp()` figure dans sa liste d’adresses et de plages CIDR :

```php
new IpAllowlistGuard(['192.0.2.0/24', '2001:db8::/32']);
```

Chaque entrée est validée à la construction de la garde : `new IpAllowlistGuard(['10.0.0.1/8'])` lance `Allowed IP "10.0.0.1/8": 10.0.0.1/8 covers 10.0.0.0/8; write 10.0.0.1/32 or 10.0.0.0/8.` Derrière un proxy inverse, l’adresse IP du client n’est correcte que si le proxy est approuvé : voir [proxies de confiance](../security/#proxies-de-confiance-et-adresse-ip-du-client).

**`RequestAttributeGuard`** laisse passer quand un attribut de requête, défini par l’un de vos propres middlewares, contient l’une des valeurs permises :

```php
new RequestAttributeGuard('role', ['admin', 'owner']);
```

La comparaison est stricte (`1` ne correspond pas à `'1'`). Un attribut qu’un paramètre de route pourrait fournir est toujours refusé : sur une route `/x/{role}`, la garde ci-dessus refuse `/x/admin`, parce qu’une valeur venue de l’URL est le choix de l’appelant, pas un fait établi par votre middleware.

**`PredicateAuthGuard`** enveloppe une fonction anonyme, pour une règle qui tient en une seule expression :

```php
new PredicateAuthGuard(fn (Request $request): bool => $request->attribute('session')?->get('email_verified') === true);
```

Pour une règle que vous réutilisez ou testez isolément, implémentez `AuthGuardInterface` dans votre propre classe.

### Combiner des gardes

`AllAuthGuard` laisse passer quand toutes les gardes passent, `AnyAuthGuard` quand au moins une passe, et `NotAuthGuard` en inverse une :

```php
$office = new IpAllowlistGuard(['192.0.2.0/24', '2001:db8::/32']);
$token = new HeaderTokenGuard($api->metricsToken);

new AllAuthGuard([$office, $token]); // from the office and with the token
new AnyAuthGuard([$office, $token]); // from the office, or with the token from anywhere
new NotAuthGuard($office);           // anywhere except the office
```

`AllAuthGuard` et `AnyAuthGuard` évaluent dans l’ordre et s’arrêtent à la première réponse qui tranche. Les deux refusent une liste vide (`At least one auth guard must be provided.`), de sorte qu’une liste construite à partir de la configuration ne peut pas tout autoriser en silence.

## Protéger des routes

Enregistrez le middleware sous un nom dans le bootstrap, puis nommez-le sur une classe de contrôleur ou une méthode avec `#[Middleware]` :

```php
$builder = $builder->registerMiddleware('metrics', new AuthGuardMiddleware(new HeaderTokenGuard($api->metricsToken)));
```

```php
namespace App\Controllers;

use Zephyrus\Controller\Controller;
use Zephyrus\Http\Response;
use Zephyrus\Routing\Attribute\Get;
use Zephyrus\Routing\Attribute\Middleware;

final class MetricsController extends Controller
{
    #[Get('/metrics')]
    #[Middleware('metrics')]
    public function index(): Response
    {
        return $this->text("requests_total 42\n");
    }
}
```

Un middleware nommé ne s’exécute que sur les routes qui le nomment, après les middlewares globaux (sessions et CSRF compris). Sur une classe, il s’applique à toutes les routes de cette classe ; les noms de classe s’exécutent avant les noms de méthode. `build()` refuse une route qui nomme un middleware que personne n’a enregistré, de sorte qu’une faute de frappe ne peut pas laisser une route ouverte. Plusieurs noms peuvent partager un alias grâce à un groupe de middlewares, décrit sur la [page des middlewares](../middleware/).

Le jeton vient de l’environnement, par une section de configuration à vous (voir [configuration](../configuration/)) qui refuse de démarrer sans lui :

```yaml
api:
  metrics_token: !env METRICS_TOKEN
  webhook_secret: !env WEBHOOK_SECRET
```

```php
namespace App;

use Zephyrus\Core\Config\ConfigSection;

final class ApiConfig extends ConfigSection
{
    public readonly string $metricsToken;
    public readonly string $webhookSecret;

    public static function fromArray(array $values): static
    {
        $section = new static($values);
        $section->metricsToken = $section->getString('metricsToken', '');
        $section->webhookSecret = $section->getString('webhookSecret', '');
        foreach (['metricsToken' => 'METRICS_TOKEN', 'webhookSecret' => 'WEBHOOK_SECRET'] as $property => $variable) {
            if (strlen($section->$property) < 32) {
                throw new \UnexpectedValueException("Set {$variable} to at least 32 random characters.");
            }
        }
        return $section;
    }
}
```

Le bootstrap enregistre la section au chargement du fichier :

```php
$config = Configuration::fromYamlFile($root . '/config.yml', ['api' => ApiConfig::class]);
$api = $config->section('api');
```

Générez un tel jeton avec `Cryptography::randomHex(64)` (voir [jetons aléatoires](../../digging-deeper/cryptography/#jetons-aléatoires)).

## Vérifier la signature d’un webhook

Un fournisseur de paiement qui appelle votre webhook n’a ni session ni jeton CSRF : sa route est inscrite sous `security.csrf.exceptions` (voir [exempter un chemin](../security/#exempter-un-chemin)), et doit authentifier l’appelant autrement. La plupart des fournisseurs signent le corps brut avec un secret partagé, ce qu’une `PredicateAuthGuard` peut vérifier :

```php
$webhookSecret = $api->webhookSecret;
$signedByProvider = new PredicateAuthGuard(
    static fn (Request $request): bool => hash_equals(
        hash_hmac('sha256', $request->body()->raw(), $webhookSecret),
        (string) $request->headers()->get('X-Signature'),
    ),
);

$builder = $builder->registerMiddleware('webhook-signature', new AuthGuardMiddleware($signedByProvider));
```

```php
#[Post('/webhooks/payments')]
#[Middleware('webhook-signature')]
public function payments(Request $request): Response
{
    $event = json_decode($request->body()->raw(), true);
    // ... act on the verified event
    return $this->noContent();
}
```

Comparez avec `hash_equals()`, jamais avec `===`, qui retourne d’autant plus tôt que les chaînes diffèrent tôt. Le secret ne doit pas être vide : un HMAC sous une clé vide est un HMAC que n’importe qui peut calculer, ce qui explique pourquoi `ApiConfig` ci-dessus refuse de démarrer sans lui. Suivez la documentation de votre fournisseur pour le nom de l’en-tête, l’encodage de la signature et tout horodatage qu’il signe pour empêcher les rejeux.

## Une connexion par session

Le reste de cette page construit une connexion par courriel et mot de passe : une table de comptes, un middleware qui identifie l’utilisateur, un contrôleur qui connecte et déconnecte, et le câblage.

### La table des comptes

```sql
CREATE TABLE account (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL UNIQUE,
    role text NOT NULL DEFAULT 'member',
    password_hash text NOT NULL
);
```

Stockez les courriels en minuscules, et ne stockez que l’empreinte du mot de passe, produite par `Cryptography::hashPassword()`. Les requêtes passent par un broker (voir [données](../data/)), toujours avec des paramètres :

```php
namespace App\Models;

use Zephyrus\Data\Broker;

final class AccountBroker extends Broker
{
    public function findByEmail(string $email): ?\stdClass
    {
        return $this->selectOne(
            'SELECT id, role, password_hash FROM account WHERE email = ?',
            [mb_strtolower(trim($email))],
        );
    }

    public function updatePasswordHash(int $id, string $hash): void
    {
        $this->updateRows('UPDATE account SET password_hash = ? WHERE id = ?', [$hash, $id]);
    }
}
```

### Identifier l’utilisateur

Ce middleware s’exécute sur chaque route protégée. Il lit l’utilisateur dans la session, envoie un visiteur anonyme vers le formulaire de connexion, et transmet l’identifiant et le rôle de l’utilisateur comme attributs de requête aux contrôleurs et aux gardes qui suivent :

```php
namespace App\Middleware;

use Zephyrus\Http\MiddlewareInterface;
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;

final class RequireUserMiddleware implements MiddlewareInterface
{
    public function process(Request $request, callable $next): Response
    {
        $session = $request->attribute('session');
        $userId = $session->get('user_id');
        if (!is_int($userId)) {
            return Response::redirect('/sign-in');
        }

        return $next($request
            ->withAttribute('userId', $userId)
            ->withAttribute('role', $session->get('role')));
    }
}
```

`$request->attribute('session')` est le `SessionManager` que `SessionMiddleware` a attaché. Le rôle est lu une seule fois, à la connexion : un utilisateur que vous rétrogradez garde l’ancien rôle jusqu’à sa prochaine connexion. Quand un changement doit s’appliquer immédiatement, lisez plutôt le rôle dans la base de données ici.

### Se connecter

```php
namespace App\Controllers;

use App\Models\AccountBroker;
use Zephyrus\Controller\Controller;
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Rendering\RenderResponses;
use Zephyrus\Routing\Attribute\Get;
use Zephyrus\Routing\Attribute\Post;
use Zephyrus\Security\Cryptography;
use Zephyrus\Session\SessionCsrfTokenManager;

final class SessionController extends Controller
{
    use RenderResponses;

    // A hash of a random value, verified when the email is unknown so both paths take as long.
    private const string TIMING_HASH = '$argon2id$v=19$m=65536,t=2,p=1$jGe3u48oXHEvj60FgOjZDQ$izjcV4X7PZeD0qI4C+eqtng43ys3vg3CKcbetYxopi4';

    public function __construct(private readonly AccountBroker $accounts)
    {
    }

    #[Get('/sign-in')]
    public function form(Request $request): Response
    {
        return $this->render('sign-in', ['next' => $request->query('next', '/account'), 'failed' => false]);
    }

    #[Post('/sign-in')]
    public function signIn(Request $request): Response
    {
        $email = (string) $request->body()->get('email', '');
        $password = (string) $request->body()->get('password', '');
        $account = $this->accounts->findByEmail($email);

        if ($account === null) {
            Cryptography::verifyPassword($password, self::TIMING_HASH);
        }
        if ($account === null || !Cryptography::verifyPassword($password, $account->password_hash)) {
            return $this->render('sign-in', ['next' => $request->body()->get('next', '/account'), 'failed' => true], 422);
        }
        if (Cryptography::needsRehash($account->password_hash)) {
            $this->accounts->updatePasswordHash($account->id, Cryptography::hashPassword($password));
        }

        $session = $request->attribute('session');
        $session->regenerate();
        (new SessionCsrfTokenManager($session))->regenerate();
        $session->set('user_id', $account->id);
        $session->set('role', $account->role);

        return $this->localRedirect($request->body()->get('next'), '/account');
    }

    #[Post('/sign-out')]
    public function signOut(Request $request): Response
    {
        $request->attribute('session')->destroy();

        return $this->redirect('/sign-in');
    }
}
```

Générez votre propre `TIMING_HASH` une seule fois avec `Cryptography::hashPassword(Cryptography::randomHex(32))` ; n’importe quelle empreinte Argon2id avec les mêmes paramètres convient. `SessionCsrfTokenManager` lit la même clé de session que celui de votre bootstrap ; si vous avez donné une clé personnalisée à ce dernier, passez-la aussi en deuxième argument ici.

### Les formulaires

`app/Views/sign-in.latte` contient le formulaire de connexion :

```latte
<form method="post" action="/sign-in">
    <input type="hidden" name="_csrf_token" value="{csrfToken()}">
    <input type="hidden" name="next" value="{$next}">
    {if $failed}<p role="alert">That email and password do not match an account.</p>{/if}
    <label>Email <input type="email" name="email" autocomplete="username" required></label>
    <label>Password <input type="password" name="password" autocomplete="current-password" required></label>
    <button>Sign in</button>
</form>
```

La déconnexion change l’état : c’est donc un formulaire avec le jeton, pas un lien. Elle se trouve dans la mise en page que prolonge chaque page destinée à un utilisateur connecté, `app/Views/layout.latte`, de sorte que chaque page porte le bouton :

```latte
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{block title}{/block}</title>
</head>
<body>
    <header>
        <form method="post" action="/sign-out">
            <input type="hidden" name="_csrf_token" value="{csrfToken()}">
            <button>Sign out</button>
        </form>
    </header>
    <main>{block content}{/block}</main>
</body>
</html>
```

Une page destinée à un utilisateur connecté commence par `{layout 'layout.latte'}` et remplit `{block content}`, comme dans la [première application](../../getting-started/first-application/#les-vues).

### Le câblage

Ajoutez la base de données et le conteneur, pour que le contrôleur reçoive son broker, et enregistrez le middleware nommé. Voici le bootstrap complet d’une application typique servie en HTTPS, avec la section `security:` de la [page de sécurité](../security/#un-bootstrap-sécurisé), la section `api:` ci-dessus et une section `database:`. Les middlewares de sécurité sont ceux de cette page, dans le même ordre :

```yaml
application:
  environment: !env APP_ENV, production
  debug: !env APP_DEBUG, false

database:
  host: !env DB_HOST, localhost
  port: !env DB_PORT, 5432
  database: !env DB_NAME
  username: !env DB_USER
  password: !env DB_PASSWORD

api:
  metrics_token: !env METRICS_TOKEN
  webhook_secret: !env WEBHOOK_SECRET

security:
  force_https: true
  allowed_hosts: [app.example.test]
  max_body_size: 1048576
  trusted_proxies: !env TRUSTED_PROXIES, ''
  csrf:
    enabled: true
    exceptions: ['#^/webhooks/#']
  headers:
    x_frame_options: DENY
    referrer_policy: same-origin
    hsts_max_age: 31536000
```

`app/Kernel.php` :

```php
namespace App;

use App\Middleware\RequireUserMiddleware;
use Zephyrus\Container\Container;
use Zephyrus\Core\Application;
use Zephyrus\Core\ApplicationBuilder;
use Zephyrus\Core\Config\Configuration;
use Zephyrus\Data\Database;
use Zephyrus\Http\Request;
use Zephyrus\Rendering\LatteEngine;
use Zephyrus\Routing\Router;
use Zephyrus\Security\AllowedHostsMiddleware;
use Zephyrus\Security\AuthGuardMiddleware;
use Zephyrus\Security\CsrfConfig;
use Zephyrus\Security\CsrfMiddleware;
use Zephyrus\Security\ForceHttpsMiddleware;
use Zephyrus\Security\HeaderTokenGuard;
use Zephyrus\Security\MaxBodySizeMiddleware;
use Zephyrus\Security\PredicateAuthGuard;
use Zephyrus\Security\RequestAttributeGuard;
use Zephyrus\Security\SecureHeadersMiddleware;
use Zephyrus\Session\SessionCsrfTokenManager;
use Zephyrus\Session\SessionManager;
use Zephyrus\Session\SessionMiddleware;

final class Kernel
{
    public static function run(string $root): void
    {
        $config = Configuration::fromYamlFile($root . '/config.yml', ['api' => ApiConfig::class]);

        $request = Request::fromGlobals(
            trustedProxies: $config->security->trustedProxies,
            trustedHeaders: $config->security->trustedHeaders,
        );

        self::application($root, $config)->handle($request)->send();
    }

    public static function application(string $root, Configuration $config): Application
    {
        $api = $config->section('api');

        $session = new SessionManager();
        $tokens = new SessionCsrfTokenManager($session);

        $views = new LatteEngine($root . '/app/Views', $root . '/cache/latte');
        $views->getLatteEngine()->addFunction('csrfToken', $tokens->getToken(...));

        $router = (new Router())->discoverControllers('App\\Controllers', $root . '/app/Controllers');

        $container = new Container();
        $container->singleton(Database::class, fn (): Database => Database::fromConfig($config->database));

        $signedByProvider = new PredicateAuthGuard(
            static fn (Request $request): bool => hash_equals(
                hash_hmac('sha256', $request->body()->raw(), $api->webhookSecret),
                (string) $request->headers()->get('X-Signature'),
            ),
        );

        return ApplicationBuilder::create()
            ->withConfiguration($config, basePath: $root)
            ->withRouter($router)
            ->withContainer($container)
            ->withRenderEngine($views)
            ->withMiddleware(new SecureHeadersMiddleware($config->security->headers))
            ->withMiddleware(new AllowedHostsMiddleware($config->security->allowedHosts))
            ->withMiddleware(new ForceHttpsMiddleware())
            ->withMiddleware(new MaxBodySizeMiddleware($config->security->maxBodySize))
            ->withMiddleware(new SessionMiddleware($config->session, $session))
            ->withMiddleware(new CsrfMiddleware($tokens, CsrfConfig::fromSecurityConfig($config->security)))
            ->registerMiddleware('auth', new RequireUserMiddleware())
            ->registerMiddleware('admin', new AuthGuardMiddleware(new RequestAttributeGuard('role', ['admin']), 403, 'Forbidden'))
            ->registerMiddleware('metrics', new AuthGuardMiddleware(new HeaderTokenGuard($api->metricsToken)))
            ->registerMiddleware('webhook-signature', new AuthGuardMiddleware($signedByProvider))
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

Pour l’exécuter sur votre machine, omettez ensemble `force_https` et la ligne `ForceHttpsMiddleware`, et inscrivez `127.0.0.1` dans `allowed_hosts` (voir la [page de sécurité](../security/#un-bootstrap-sécurisé)). Protégez ensuite un contrôleur :

```php
namespace App\Controllers;

use Zephyrus\Controller\Controller;
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Rendering\RenderResponses;
use Zephyrus\Routing\Attribute\Get;
use Zephyrus\Routing\Attribute\Middleware;

#[Middleware('auth')]
final class AdminController extends Controller
{
    use RenderResponses;

    #[Get('/account')]
    public function account(Request $request): Response
    {
        return $this->render('account', ['user' => $request->attribute('userId')]);
    }

    #[Get('/admin/users')]
    #[Middleware('admin')]
    public function users(): Response
    {
        return $this->json(['users' => []]);
    }
}
```

`/account` affiche `app/Views/account.latte`, qui étend la mise en page, de sorte que le bouton de déconnexion se trouve sur la page :

```latte
{layout 'layout.latte'}

{block title}Account{/block}

{block content}
    <h1>Your account</h1>
    <p>You are signed in as user {$user}.</p>
{/block}
```

Un visiteur anonyme qui se rend à `/account` est redirigé vers `/sign-in` ; un membre qui ouvre `/admin/users` reçoit un 403 `{"error":"Forbidden"}` ; un administrateur obtient la liste.

### Ce que tente un attaquant

Chaque étape ci-dessus répond à une attaque connue :

- **Fixation de session.** L’attaquant impose un identifiant de session dans le navigateur de la victime, attend la connexion, puis utilise le même identifiant. `regenerate()` donne à la session authentifiée un nouvel identifiant, et un gestionnaire de sauvegarde de session qui implémente `validateId()` refuse les identifiants qu’il n’a pas créés. Le gestionnaire de fichiers par défaut de PHP et `DatabaseSessionHandler` le font ; avec un gestionnaire personnalisé qui n’a pas `validateId()`, le mode strict est inopérant et `start()` en avertit en mode débogage (voir [sessions](../sessions/)).
- **Un jeton lu avant la connexion.** `(new SessionCsrfTokenManager($session))->regenerate()` remplace le jeton CSRF, de sorte que celui lu depuis la page anonyme cesse de fonctionner : un envoi qui le porte après la connexion reçoit un 403.
- **CSRF de connexion.** Un formulaire forgé connecte la victime au compte de l’attaquant, pour recueillir ce qu’elle saisit. Le formulaire de connexion porte le jeton comme n’importe quel autre.
- **Énumération de comptes.** La réponse pour un courriel inconnu et pour un mauvais mot de passe est la même page, le même statut (422) et à peu près le même temps, parce que le chemin du courriel inconnu vérifie aussi `TIMING_HASH`. Cela ne tient que tant que chaque empreinte stockée a les paramètres de `TIMING_HASH` : une empreinte bcrypt importée, ou une empreinte Argon2id avec les paramètres par défaut de PHP, prend un temps de vérification mesurablement différent (126 ms pour un courriel inconnu, 147 ms pour une empreinte issue de `hashPassword()`, 208 ms pour une empreinte Argon2id aux paramètres par défaut de PHP, presque rien pour bcrypt), de sorte que ces comptes peuvent être distingués tant qu’ils ne sont pas migrés.
- **Redirection ouverte.** Le champ `next` est le choix de l’appelant. `localRedirect()` ne suit qu’un chemin local, et se rabat sur `/account` pour `https://evil.example/` ou `//evil.example/`.
- **Devinette de mots de passe.** Zephyrus n’a pas de limiteur de débit. Limitez les tentatives de connexion par compte et par adresse, à votre proxy inverse ou dans votre propre middleware sur la route `POST /sign-in`.
- **Un témoin de session volé.** Gardez le témoin de session `http_only` et `secure`, avec `same_site: Lax` ou `Strict` (voir [sessions](../sessions/)), et servez chaque page en HTTPS.
- **Déconnexion forcée.** Se déconnecter est un `POST` avec le jeton : un lien ou une image sur un autre site ne peut pas déconnecter vos utilisateurs.

## À savoir

- `verifyPassword()` accepte n’importe quelle empreinte Argon2id, y compris une empreinte issue de `password_hash($password, PASSWORD_ARGON2ID)` de PHP ; `needsRehash()` retourne alors `true`, et la connexion ci-dessus stocke la nouvelle empreinte. Elle retourne `false` pour une empreinte bcrypt : pour migrer de tels comptes, vérifiez-les avec `password_verify()` et stockez `Cryptography::hashPassword()` en cas de succès. Tant qu’un compte n’est pas migré, son temps de connexion diffère de celui du chemin du courriel inconnu (voir l’énumération de comptes ci-dessus).
- Affichez un seul message pour les deux échecs. « Aucun compte avec ce courriel » indique à un attaquant quels courriels sont inscrits ; ne fournissez cette information que par un courriel de réinitialisation de mot de passe.
- Sans `SessionMiddleware` monté globalement, `$request->attribute('session')` vaut `null` et les écritures `session()` sont abandonnées en silence (voir [sessions](../sessions/)). Montez-le avant tout middleware de route qui lit l’utilisateur.
- `AuthGuardMiddleware` répond toujours en JSON. Pour les pages, redirigez depuis votre propre middleware, comme le fait `RequireUserMiddleware`.
- Stockez le moins possible dans la session : l’identifiant de l’utilisateur et ce que vous devez vérifier à chaque requête. Lisez le reste dans la base de données.
