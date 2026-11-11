---
title: Sessions
order: 9
description: Start and configure the session, read and write its data, rotate the id on sign-in, flash one-time messages, and store sessions in PostgreSQL.
---

# Sessions

State that follows a visitor.

`SessionMiddleware` starts the session before your controller runs. From then on you read and write it through a `SessionManager`, and the browser keeps nothing but an opaque id in a cookie.

## Mount the middleware

```php
use Zephyrus\Session\SessionCsrfTokenManager;
use Zephyrus\Session\SessionManager;
use Zephyrus\Session\SessionMiddleware;

$session = new SessionManager();
$tokens = new SessionCsrfTokenManager($session);

$app = ApplicationBuilder::create()
    ->withConfiguration($config, basePath: $root)
    ->withRouter($router)
    ->withMiddleware(new SessionMiddleware($config->session, $session))
    ->withMiddleware(new CsrfMiddleware($tokens, CsrfConfig::fromSecurityConfig($config->security)))
    ->build();
```

The middleware starts the session with the cookie settings of the `session:` section, registers the manager for the `session()` helper and for `Flash`, and puts it on the request as the `session` attribute. It is a global middleware, so it also runs on 404 answers: a request that matches no route still opens a session. Register middleware that can refuse a request (`ForceHttpsMiddleware`, `AllowedHostsMiddleware`) before it, so a refused request never gets a cookie. See [Middleware](../middleware/).

Mount it **before** `CsrfMiddleware`: the token lives in the session. The session-backed token manager and the CSRF protection itself are described on [Security](../security/).

Without `SessionMiddleware`, `session([...])` writes and flash messages are dropped silently, and `$request->attribute('session')` is `null`.

## Read and write

In a controller, take the manager from the request:

```php
use Zephyrus\Session\SessionManager;

#[Post('/visit')]
public function visit(Request $request): Response
{
    /** @var SessionManager $session */
    $session = $request->attribute('session');
    $session->set('visits', $session->get('visits', 0) + 1);

    return $this->json(['visits' => $session->get('visits')]);
}
```

Two requests with the same cookie printed `{"visits":1}` then `{"visits":2}`. The manager:

| Method | What it does |
|---|---|
| `get($key, $default = null)` | The value, or the default when the key is absent. |
| `set($key, $value)` | Stores a value. Throws `SessionException` when no session is active. |
| `has($key)` | Whether the key exists, even when its value is `null`. |
| `remove($key)` | Deletes a key. Nothing happens when the session was read and lacks it. |
| `all()` | Every key and value. |
| `flash($key, $default = null)` | Reads a value and removes it in the same call. |
| `id()` | The session id, `''` when no session is running. |
| `isStarted()` | Whether a session is active. |

Keys are non-empty strings; an empty key throws `SessionException`. Anything PHP can serialise can be stored, but store ids and small values, not entities or large arrays.

The `session()` helper reads and writes through the registered manager: `session('visits', 0)` reads, `session(['visits' => 3])` writes. It is handy in a template, and `$request->attribute('session')` is clearer in a controller.

### Rotate the id on sign-in

A session id that was valid before a sign-in must not stay valid after it, or someone who planted that id keeps the signed-in session. After checking credentials, rotate the id, rotate the CSRF token, and only then store the user:

```php
use Zephyrus\Session\Flash;
use Zephyrus\Session\SessionCsrfTokenManager;

#[Post('/sign-in')]
public function signIn(Request $request): Response
{
    /** @var SessionManager $session */
    $session = $request->attribute('session');

    // ...check the credentials first, then:
    $session->regenerate();
    (new SessionCsrfTokenManager($session))->regenerate();
    $session->set('user_id', 42);
    Flash::success('Welcome back.');

    return Response::redirect('/me');
}
```

`regenerate()` issues a new id and deletes the old session data (`regenerate(false)` keeps it). In the run, the cookie changed from `84201137...` to `056c96de...` on the sign-in response, and the form token fetched before the sign-in was refused afterwards with a 403: that is the second line doing its job. `new SessionCsrfTokenManager($session)` shares its token with the one in your bootstrap; if the bootstrap passed a custom session key as the second argument, pass the same one here.

### Destroy on sign-out

```php
#[Post('/sign-out')]
public function signOut(Request $request): Response
{
    /** @var SessionManager $session */
    $session = $request->attribute('session');
    $session->destroy();

    return Response::redirect('/');
}
```

`destroy()` empties the session and deletes it from the store. It throws `SessionException` when the store refuses, so a sign-out never reports success while the data survives. Catch it where a fallback must still run. The browser keeps its cookie, but the id now matches nothing: the next request starts a new session. A sign-out is a state change: make it a `POST` behind the CSRF middleware, never a link.

## Flash messages

A flash message lives until the next time it is read, which makes it the way to say something across a redirect:

```php
use Zephyrus\Session\Flash;

Flash::success('Saved.');                  // before the redirect
$flash = Flash::readAll();                 // after it
// $flash->success, ->error, ->warning, ->info: lists of strings
```

`Flash::success()`, `error()`, `warning()` and `info()` each take a string or a list of strings and append to what is already stored. `readAll()` returns an object with the four lists and clears them. `Flash::clearAll()` clears without reading. After `Flash::success('Saved.')` and `Flash::error(['a', 'b'])`, `readAll()` returned `{"success":["Saved."],"error":["a","b"],"warning":[],"info":[]}` and a second call returned four empty lists.

Read the messages in the controller that renders the page and pass them to the view:

```php
return $this->render('contact', ['flash' => Flash::readAll()]);
```

```latte
{foreach $flash->success as $message}<p role="status">{$message}</p>{/foreach}
```

Flash messages often carry user input. Latte escapes them; the PHP engine does not, so wrap them with `e()` there (see [Views](../views/)).

## Configure the cookie

The `session:` section controls the cookie. The values shown are the defaults:

```yaml
session:
  name: PHPSESSID       # the cookie name
  lifetime: 0           # seconds; 0 is a browser-session cookie
  http_only: true       # scripts cannot read the cookie
  secure: auto          # true, false or auto
  same_site: Lax        # Strict, Lax or None
  cookie_path: /
  idle_timeout: null    # seconds of inactivity, DatabaseSessionHandler only
```

`SessionConfig` is the typed object behind it, available as `$config->session`. Keys can be written in snake_case or camelCase, but one spelling per key. An unknown key, or a misspelled one, refuses to boot: `Configuration section 'session' field 'lifetim' is an unknown key: did you mean "lifetime"?`

- **`secure: auto`** adds the `Secure` attribute on HTTPS requests and leaves it off on plain HTTP, so local development keeps working. In the run over plain HTTP the cookie was `APP_SESSION=...; path=/; HttpOnly; SameSite=Lax`. Set `secure: true` in production so the cookie is never sent over HTTP. `secure: false` never sets it. Behind a proxy that terminates TLS, `auto` sees HTTPS only when the proxy is listed in `security.trustedProxies`.
- **`http_only: true`** keeps JavaScript away from the cookie. Leave it on.
- **`same_site: Lax`** sends the cookie on top-level navigations but not on cross-site requests that submit forms or load resources. `Strict` also withholds it when a visitor arrives from another site. `None` needs `Secure`.
- **No `Domain` attribute** is ever set: the cookie belongs to the exact host that issued it.
- **`lifetime`** is the cookie's life in seconds. It does not shorten the session on the server.
- **`idle_timeout`** is enforced on read by `DatabaseSessionHandler`. With PHP's files handler it is only a garbage-collection age: nothing checks how long the session sat idle when it is read. In debug mode the framework warns about it.

Combinations a browser would silently drop are refused at boot: `SameSite=None` without `Secure`, a `__Host-` name with a path other than `/`, a `__Secure-` or `__Host-` name that can never be `Secure`. For example, `same_site: None` with `secure: false` fails with `... requires secure to be true or auto: browsers discard a SameSite=None cookie without Secure.`

## Store sessions in PostgreSQL

By default PHP keeps sessions in files. To share sessions between servers, or to enforce `idle_timeout`, store them in PostgreSQL. Create the table once:

```sql
CREATE TABLE public.session (
    session_id VARCHAR PRIMARY KEY,
    access     INTEGER NOT NULL,
    expire     INTEGER NOT NULL,
    data       TEXT NOT NULL DEFAULT ''
);

CREATE INDEX session_access_idx ON public.session (access);
```

Then register the handler on the manager, before `build()`:

```php
use Zephyrus\Data\Database;
use Zephyrus\Session\DatabaseSessionHandler;

$session = new SessionManager();
$session->setHandler(new DatabaseSessionHandler(
    fn (): Database => Database::fromConfig($config->database),
));
```

The closure delays the connection until the session is first read. You can pass a `Database` instead. The handler writes to `public.session` by default; its second to fourth arguments set another table name, id column name and id pattern. `setHandler()` must run before the session starts, and throws `SessionException` when PHP refuses it.

After a visit that stored `visits`, the table held one row whose `data` was `_csrf_token|s:64:"...";visits|i:1;`. The data is PHP's session serialisation, kept as text. Payloads that are not valid UTF-8 are stored base64-encoded, so do not search `data` with `LIKE`.

Good to know about this handler:

- **It enforces the idle timeout.** A row past its `expire`, or idle for longer than `idle_timeout`, is neither resumed nor read.
- **An empty new session is not stored.** An anonymous visitor who never writes anything gets a new cookie on each request until something is stored in the session (the CSRF token counts).
- **Close, regenerate or destroy outside a database transaction** on the same connection: a failing session write aborts the transaction and the lock stays held until the connection closes.
- **It turns on strict mode** (`session.use_strict_mode`) itself, so an id the client invents is not adopted. `SessionManager::start()` does the same for any handler.

### Session locking

Two requests of one visitor can run at the same moment: a page and an AJAX call, say. Without protection, both read the session, both write it, and the later write erases the earlier one. `DatabaseSessionHandler` therefore takes a PostgreSQL advisory lock on the session id when it reads, and releases it when the session closes. The second request waits (up to five seconds, then goes on without the lock rather than hanging) until the first has finished.

A route that reads `visits`, waits a second and writes `visits + 1`, called twice in parallel with the same cookie from a count of 1, ended at 3 with the lock. With `lockSessions: false`, both calls answered `{"visits":2}`: one update was lost.

The lock has a cost: a slow request blocks the others of the same visitor, so finish the work that does not need the session early, or avoid long requests that hold it. Pass `lockSessions: false` only behind PgBouncer in transaction or statement pooling mode, where the lock would stay on a server connection after the request:

```php
new DatabaseSessionHandler($open, lockSessions: false);
```

With the files handler, PHP locks the session file for the length of the request with the same effect.

## Test code that uses the session

`new SessionManager([])` keeps everything in the array you pass instead of PHP's session, with a simulated id. It is meant for tests and command-line scripts (see [Testing](../../digging-deeper/testing/)):

```php
$session = new SessionManager([]);
$application = Kernel::application($root, $config, $session);
```

In this mode `start()` does nothing, `isStarted()` is always `true`, and `regenerate()` and `destroy()` change the simulated id and clear the array.

## Good to know

- **No middleware, silent loss.** Without `SessionMiddleware`, flash messages and `session([...])` writes are dropped without an error.
- **A write needs an active session.** `set()` on a real manager that was never started throws `SessionException`: `Cannot write "a" to the session: no session is active. Run SessionMiddleware on this route, or call start(); in a test, pass an array to new SessionManager([]).`
- **Always rotate on privilege change.** Call `regenerate()` and the token manager's `regenerate()` at sign-in, and again when a user gains rights.
- **Do not store the whole user.** Store the id and load the user per request, so a changed role takes effect at once.
