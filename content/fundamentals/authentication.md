---
title: Authentication
order: 10
description: Protect routes with guards and named middleware, and build a session sign-in and sign-out that resists fixation, enumeration and open redirects.
---

# Authentication

Your users, your rules.

Zephyrus has no user model, no account table and no sign-in screen: who your users are and how they prove it belongs to your application. What the framework gives you are the pieces that are easy to get wrong:

- **Guards** decide whether a request may continue, and `AuthGuardMiddleware` turns a guard into a middleware you attach to routes.
- **Sessions** with id rotation, and **CSRF tokens** you rotate at sign-in (see [sessions](../sessions/) and [security](../security/#csrf-protection)).
- **Password hashing** with Argon2id, in [Cryptography](../../digging-deeper/cryptography/).

This page shows the guards first, then a complete session sign-in built from those pieces.

## Guards

A guard answers one question about a request:

```php
namespace Zephyrus\Security;

use Zephyrus\Http\Request;

interface AuthGuardInterface
{
    public function isAuthorized(Request $request): bool;
}
```

`AuthGuardMiddleware` runs a guard and stops the request when it answers `false`. By default the refusal is a 401 with `{"error":"Unauthorized"}`; the second and third arguments change the status and the message:

```php
use Zephyrus\Security\AuthGuardMiddleware;
use Zephyrus\Security\RequestAttributeGuard;

new AuthGuardMiddleware($guard);                                                // 401 {"error":"Unauthorized"}
new AuthGuardMiddleware(new RequestAttributeGuard('role', ['admin']), 403, 'Forbidden'); // 403 {"error":"Forbidden"}
```

The answer is always JSON, which suits an API. For pages a person visits, write a middleware of your own that redirects to the sign-in form, as in [identifying the user](#identifying-the-user) below.

### The built-in guards

**`HeaderTokenGuard`** compares a header with a secret token, in constant time. By default it reads `Authorization: Bearer <token>`:

```php
new HeaderTokenGuard($api->metricsToken);                  // Authorization: Bearer <token>
new HeaderTokenGuard($api->metricsToken, 'X-Api-Key', ''); // X-Api-Key: <token>, no prefix
```

A missing or empty header is refused, and so is every request when the expected token is empty, so an unset secret locks the route rather than opening it. A value sent without the `Bearer ` prefix is compared whole.

**`IpAllowlistGuard`** passes when `$request->clientIp()` is in its list of addresses and CIDR ranges:

```php
new IpAllowlistGuard(['192.0.2.0/24', '2001:db8::/32']);
```

Each entry is validated when the guard is built: `new IpAllowlistGuard(['10.0.0.1/8'])` throws `Allowed IP "10.0.0.1/8": 10.0.0.1/8 covers 10.0.0.0/8; write 10.0.0.1/32 or 10.0.0.0/8.` Behind a reverse proxy, the client IP is only right when the proxy is trusted: see [trusted proxies](../security/#trusted-proxies-and-the-client-ip).

**`RequestAttributeGuard`** passes when a request attribute, set by one of your own middleware, holds one of the allowed values:

```php
new RequestAttributeGuard('role', ['admin', 'owner']);
```

The comparison is strict (`1` does not match `'1'`). An attribute that a route placeholder could supply is always refused: on a route `/x/{role}`, the guard above refuses `/x/admin`, because a value from the URL is the caller's choice, not a fact your middleware established.

**`PredicateAuthGuard`** wraps a closure, for a rule that fits in one expression:

```php
new PredicateAuthGuard(fn (Request $request): bool => $request->attribute('session')?->get('email_verified') === true);
```

For a rule you reuse or test on its own, implement `AuthGuardInterface` in a class of your own.

### Combining guards

`AllAuthGuard` passes when every guard passes, `AnyAuthGuard` when at least one does, and `NotAuthGuard` inverts one:

```php
$office = new IpAllowlistGuard(['192.0.2.0/24', '2001:db8::/32']);
$token = new HeaderTokenGuard($api->metricsToken);

new AllAuthGuard([$office, $token]); // from the office and with the token
new AnyAuthGuard([$office, $token]); // from the office, or with the token from anywhere
new NotAuthGuard($office);           // anywhere except the office
```

`AllAuthGuard` and `AnyAuthGuard` evaluate in order and stop at the first answer that decides. Both refuse an empty list (`At least one auth guard must be provided.`), so a list built from configuration cannot quietly authorize everything.

## Protecting routes

Register the middleware under a name in the bootstrap, then name it on a controller class or method with `#[Middleware]`:

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

A named middleware runs only on the routes that name it, after the global ones (sessions and CSRF included). On a class, it applies to every route of that class; class names run before method names. `build()` refuses a route that names a middleware nobody registered, so a typo cannot leave a route open. Several names can share one alias with a middleware group, described on the [middleware page](../middleware/).

The token comes from the environment, through a configuration section of your own (see [configuration](../configuration/)) that refuses to boot without it:

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

The bootstrap registers the section when it loads the file:

```php
$config = Configuration::fromYamlFile($root . '/config.yml', ['api' => ApiConfig::class]);
$api = $config->section('api');
```

Generate such a token with `Cryptography::randomHex(64)` (see [random tokens](../../digging-deeper/cryptography/#random-tokens)).

## Verifying a webhook signature

A payment provider calling your webhook has no session and no CSRF token: its route is listed under `security.csrf.exceptions` (see [exempting a path](../security/#exempting-a-path)), and must authenticate the caller another way. Most providers sign the raw body with a shared secret, which a `PredicateAuthGuard` can check:

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

Compare with `hash_equals()`, never `===`, which returns sooner the earlier the strings differ. The secret must not be empty: an HMAC under an empty key is one anyone can compute, which is why `ApiConfig` above refuses to boot without it. Follow your provider's documentation for the header name, the encoding of the signature and any timestamp it signs to stop replays.

## A session sign-in

The rest of this page builds an email and password sign-in: an account table, a middleware that identifies the user, a controller that signs in and out, and the wiring.

### The account table

```sql
CREATE TABLE account (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL UNIQUE,
    role text NOT NULL DEFAULT 'member',
    password_hash text NOT NULL
);
```

Store emails in lowercase, and store only the hash of the password, from `Cryptography::hashPassword()`. The queries go through a broker (see [data](../data/)), always with parameters:

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

### Identifying the user

This middleware runs on every protected route. It reads the user from the session, sends an anonymous visitor to the sign-in form, and passes the user id and role on as request attributes for the controllers and guards after it:

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

`$request->attribute('session')` is the `SessionManager` that `SessionMiddleware` attached. The role is read once, at sign-in: a user you demote keeps the old role until they sign in again. When a change must apply at once, read the role from the database here instead.

### Signing in

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
        return $this->render('sign-in', ['next' => $request->query('next', '/'), 'failed' => false]);
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
            return $this->render('sign-in', ['next' => $request->body()->get('next', '/'), 'failed' => true], 422);
        }
        if (Cryptography::needsRehash($account->password_hash)) {
            $this->accounts->updatePasswordHash($account->id, Cryptography::hashPassword($password));
        }

        $session = $request->attribute('session');
        $session->regenerate();
        (new SessionCsrfTokenManager($session))->regenerate();
        $session->set('user_id', $account->id);
        $session->set('role', $account->role);

        return $this->localRedirect($request->body()->get('next'), '/');
    }

    #[Post('/sign-out')]
    public function signOut(Request $request): Response
    {
        $request->attribute('session')->destroy();

        return $this->redirect('/sign-in');
    }
}
```

Generate your own `TIMING_HASH` once with `Cryptography::hashPassword(Cryptography::randomHex(32))`; any Argon2id hash with the same parameters works. `SessionCsrfTokenManager` reads the same session key as the one in your bootstrap; if you gave that one a custom key, pass it as the second argument here too.

### The forms

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

Signing out changes state, so it is a form with the token, not a link:

```latte
<form method="post" action="/sign-out">
    <input type="hidden" name="_csrf_token" value="{csrfToken()}">
    <button>Sign out</button>
</form>
```

### Wiring it

Add the container, so the controller receives its broker, and register the two named middleware:

```php
$container = new Container();
$container->singleton(Database::class, fn (): Database => Database::fromConfig($config->database));

return ApplicationBuilder::create()
    ->withConfiguration($config, basePath: $root)
    ->withRouter($router)
    ->withContainer($container)
    ->withRenderEngine($views)
    // ... the global security middleware, SessionMiddleware and CsrfMiddleware
    ->registerMiddleware('auth', new RequireUserMiddleware())
    ->registerMiddleware('admin', new AuthGuardMiddleware(new RequestAttributeGuard('role', ['admin']), 403, 'Forbidden'))
    ->build();
```

The global middleware are the ones from the [security bootstrap](../security/#a-secure-bootstrap). Then protect a controller:

```php
namespace App\Controllers;

use Zephyrus\Controller\Controller;
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Routing\Attribute\Get;
use Zephyrus\Routing\Attribute\Middleware;

#[Middleware('auth')]
final class AdminController extends Controller
{
    #[Get('/account')]
    public function account(Request $request): Response
    {
        return $this->json(['user' => $request->attribute('userId')]);
    }

    #[Get('/admin/users')]
    #[Middleware('admin')]
    public function users(): Response
    {
        return $this->json(['users' => []]);
    }
}
```

An anonymous visitor to `/account` is redirected to `/sign-in`; a member who opens `/admin/users` gets a 403 `{"error":"Forbidden"}`; an admin gets the list.

### What an attacker tries

Each step above answers a known attack:

- **Session fixation.** The attacker plants a session id in the victim's browser, waits for the sign-in, then uses the same id. `regenerate()` gives the signed-in session a new id, and the session refuses ids it did not create.
- **A token read before sign-in.** `(new SessionCsrfTokenManager($session))->regenerate()` replaces the CSRF token, so one read from the anonymous page stops working: a post carrying it after sign-in is a 403.
- **Login CSRF.** A forged form signs the victim into the attacker's account, to collect what they type. The sign-in form carries the token like any other.
- **Account enumeration.** The answer to an unknown email and to a wrong password is the same page, the same status (422) and roughly the same time, because the unknown-email path verifies `TIMING_HASH` too.
- **Open redirect.** The `next` field is the caller's choice. `localRedirect()` only follows a local path such as `/account`, and falls back to `/` for `https://evil.example/` or `//evil.example/`.
- **Password guessing.** Zephyrus has no rate limiter. Limit sign-in attempts per account and per address, at your reverse proxy or in a middleware of your own on the `POST /sign-in` route.
- **A stolen session cookie.** Keep the session cookie `http_only` and `secure`, with `same_site: Lax` or `Strict` (see [sessions](../sessions/)), and serve every page over HTTPS.
- **Forced sign-out.** Signing out is a `POST` with the token: a link or an image on another site cannot sign your users out.

## Good to know

- `verifyPassword()` accepts any Argon2id hash, including one from PHP's `password_hash($password, PASSWORD_ARGON2ID)`; `needsRehash()` then returns `true`, and the sign-in above stores the new hash. It returns `false` for a bcrypt hash: to migrate such accounts, check them with `password_verify()` and store `Cryptography::hashPassword()` on success.
- Show one message for both failures. "No account with this email" tells an attacker which emails are registered; offer that information only through a password reset email.
- Without `SessionMiddleware` mounted globally, `$request->attribute('session')` is `null` and `session()` writes are dropped silently (see [sessions](../sessions/)). Mount it before any route middleware that reads the user.
- `AuthGuardMiddleware` always answers JSON. For pages, redirect from your own middleware as `RequireUserMiddleware` does.
- Store as little as you need in the session: the user id and what you must check on every request. Read the rest from the database.
