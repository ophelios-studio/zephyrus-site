---
title: Security
order: 11
description: How Zephyrus checks your security configuration at boot, and how to enforce CSRF protection, security headers, HTTPS, allowed hosts, trusted proxies and a request size limit.
---

# Security

Declared once, enforced on every request.

Zephyrus ships its protections as middleware that you mount yourself, and reads their values from the `security:` section of `config.yml`. Nothing under `security:` is applied for you. Instead, `build()` checks that every protection the configuration declares is really enforced by a mounted middleware, and refuses to boot when one is missing. A setting cannot sit in the file looking active while nothing reads it.

Sessions are covered on the [sessions page](../sessions/), signing users in on the [authentication page](../authentication/), and the Content-Security-Policy header on its [own page](../../digging-deeper/content-security-policy/).

## A secure bootstrap

This is the `security:` section and the bootstrap of a typical application served over HTTPS at `app.example.test`:

```yaml
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
    permissions_policy: 'camera=(), microphone=(), geolocation=()'
```

```php
namespace App;

use Zephyrus\Core\Application;
use Zephyrus\Core\ApplicationBuilder;
use Zephyrus\Core\Config\Configuration;
use Zephyrus\Http\Request;
use Zephyrus\Rendering\LatteEngine;
use Zephyrus\Routing\Router;
use Zephyrus\Security\AllowedHostsMiddleware;
use Zephyrus\Security\CsrfConfig;
use Zephyrus\Security\CsrfMiddleware;
use Zephyrus\Security\ForceHttpsMiddleware;
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
            maxBodySize: $config->security->maxBodySize,
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

        return ApplicationBuilder::create()
            ->withConfiguration($config, basePath: $root)
            ->withRouter($router)
            ->withRenderEngine($views)
            ->withMiddleware(new SecureHeadersMiddleware($config->security->headers))
            ->withMiddleware(new AllowedHostsMiddleware($config->security->allowedHosts))
            ->withMiddleware(new ForceHttpsMiddleware())
            ->withMiddleware(new MaxBodySizeMiddleware($config->security->maxBodySize))
            ->withMiddleware(new SessionMiddleware($config->session, $session))
            ->withMiddleware(new CsrfMiddleware($tokens, CsrfConfig::fromSecurityConfig($config->security)))
            ->build();
    }
}
```

The first middleware added runs outermost. `SecureHeadersMiddleware` comes first so that every response carries the headers, including the redirect, the 400 and the 413 that the middleware after it answer on their own. `AllowedHostsMiddleware` comes before `ForceHttpsMiddleware`: the other way round, a plain HTTP request for any `Host` gets a cacheable 308 to that host before the host is checked. `SessionMiddleware` must run before `CsrfMiddleware`, which keeps its token in the session. `MaxBodySizeMiddleware` must run before `CsrfMiddleware` too: a body cut at the read limit reads as an empty form, so a CSRF check placed first answers 403 instead of 413.

For local development over plain HTTP, leave `force_https` and `ForceHttpsMiddleware` out together (the middleware redirects every plain request to `https://`, whatever the configuration says), or send `X-Forwarded-Proto: https` from a trusted proxy. List the local host in `allowed_hosts` too, such as `127.0.0.1`.

`Request::fromGlobals()` never reads `config.yml`: pass the proxy settings and the body limit to it yourself, as above (see [trusted proxies](#trusted-proxies-and-the-client-ip) and [request body size](#request-body-size)).

## The boot-time wiring check

Each key you write under `security:` is a promise. When `build()` finds a declared key that no global middleware enforces with the same value, it refuses to boot and lists every gap at once. The same configuration with no middleware mounted gives:

```text
Zephyrus\Core\Config\ConfigurationException: Configuration declares security settings that this application does not enforce as declared:
  - security.forceHttps is not enforced as declared: mount Zephyrus\Security\ForceHttpsMiddleware with withMiddleware()
  - security.allowedHosts is not enforced as declared: mount new Zephyrus\Security\AllowedHostsMiddleware(...) globally with withMiddleware(), built from the configuration's security->allowedHosts
  - security.csrf is not enforced as declared: mount new Zephyrus\Security\CsrfMiddleware(...) globally with withMiddleware(), built from the configuration's security through CsrfConfig::fromSecurityConfig()
  - security.maxBodySize is not enforced as declared: mount new Zephyrus\Security\MaxBodySizeMiddleware(...) globally with withMiddleware(), built from the configuration's security->maxBodySize
  - security.headers is not enforced as declared: mount new Zephyrus\Security\SecureHeadersMiddleware(...) globally with withMiddleware(), built from the configuration's security->headers

Apply the fix given for each setting, or acknowledge the gap explicitly with ApplicationBuilder::withAcknowledgedSecurityKeys([...]) when the protection is provided elsewhere (a reverse proxy, a wrapping middleware, the web server).
```

What each declared key requires:

| Declared | Mount with `withMiddleware()` |
| --- | --- |
| `force_https: true` | `new ForceHttpsMiddleware()` |
| a non-empty `allowed_hosts` | `new AllowedHostsMiddleware($config->security->allowedHosts)` |
| `max_body_size` above 0 | `new MaxBodySizeMiddleware($config->security->maxBodySize)`, or a stricter limit |
| `headers` | `new SecureHeadersMiddleware($config->security->headers)` |
| any `csrf` key, with `enabled` true | `new CsrfMiddleware($tokens, CsrfConfig::fromSecurityConfig($config->security))` |

The check compares values, not only classes. A `MaxBodySizeMiddleware(5000000)` under `max_body_size: 1048576` is refused for carrying "a looser limit (5000000 bytes) than security.maxBodySize (1048576 bytes)", while a stricter limit passes. A `SecureHeadersMiddleware(SecureHeadersConfig::defaults())` under a declared `headers` section is refused because it "carries another configuration". A `CsrfMiddleware` built with `new CsrfConfig()` is refused when `security.csrf.exceptions` lists a pattern it does not exclude.

When a protection really lives somewhere `build()` cannot see (TLS redirection at the load balancer, a host allowlist in the web server), name that key:

```php
$builder = $builder->withAcknowledgedSecurityKeys(['forceHttps', 'security.allowedHosts']);
```

The accepted names are `forceHttps`, `allowedHosts`, `csrf`, `maxBodySize` and `headers`, bare or prefixed with `security.`. Any other name is refused with the closest one: `Unknown security key "max_body_size". Accepted names: forceHttps, allowedHosts, csrf, maxBodySize, headers, each short or prefixed with "security.". Did you mean "maxBodySize"?`

`withoutSecurityWiringCheck()` turns the whole check off. Prefer acknowledging the one key: the check then stays live for every other setting, including the ones you add later.

### Good to know

- Only declared keys are checked. An application whose `config.yml` has no `security:` section boots with no security middleware at all. That is a valid choice for an internal tool, not a safe default for a public site.
- `max_body_size` reads as `2097152` when you leave it out. `Request::fromGlobals()` reads at most that much of a body, and the kernel answers 413 to a body cut there, but the limit you declare is enforced only by a mounted `MaxBodySizeMiddleware`.
- A middleware registered under a route name with `registerMiddleware()`, or wrapped inside another middleware, does not count. The refusal says so: "it is registered only under route name 'csrf'".
- Every `with*()` call returns a new builder. `$builder->withMiddleware(...)` on a line of its own, with the result dropped, mounts nothing and gets the same refusal as no middleware at all: chain the calls, or write `$builder = $builder->withMiddleware(...)`.
- `trusted_proxies`, `trusted_headers` and `encryption` are not checked: they are read outside the builder (by `Request::fromGlobals()` and your own code). Neither is the `session:` section: mount `SessionMiddleware` yourself.
- A route cannot skip a security middleware. `#[WithoutMiddleware(CsrfMiddleware::class)]` is refused when routes are registered: `Route "POST /hook" cannot skip "Zephyrus\Security\CsrfMiddleware": it is a framework security middleware. Exempt the path under security.csrf.exceptions instead`. The same holds for the HTTPS, host, body size, header and Content-Security-Policy middleware.

## The security section

Every key, with its default when you leave it out. Keys are accepted in snake_case or camelCase, one spelling per key, and an unknown key stops the boot with the closest accepted one.

| Key | Default | Meaning |
| --- | --- | --- |
| `force_https` | `false` | Redirect plain HTTP to HTTPS. |
| `allowed_hosts` | `[]` | Host names the application answers to. Empty accepts every host. |
| `max_body_size` | `2097152` | Largest request body in bytes. `0` is unlimited. |
| `trusted_proxies` | `[]` | Addresses or CIDR ranges of your reverse proxies. Empty trusts none. |
| `trusted_headers` | the `X-Forwarded-*` family | Forwarding headers read from a trusted proxy. |
| `csrf.enabled` | `true` | Verify a token on state-changing requests. |
| `csrf.exceptions` | `[]` | Path patterns exempt from the check. |
| `encryption.key` | none | Base64url key for [encryption](../../digging-deeper/cryptography/). |
| `headers` | the defaults below | Security response headers. |

Read the values through typed properties: `$config->security->allowedHosts`, `$config->security->maxBodySize`, `$config->security->headers` (a `SecureHeadersConfig`). `$config->security->isDeclared('maxBodySize')` tells whether the file named a key at all, which is what the wiring check relies on.

The section is strict, so a value that would silently do something else stops the boot instead. Each refusal is a `ConfigurationException`, shown with the setting that causes it:

```text
max_body_size: 2M
  Configuration section 'security' field 'max_body_size' has invalid value "2M": must be a number of bytes, for example 2097152 (no unit suffix).
allowed_hosts: ['example.com:99999']
  Configuration section 'security' field 'allowedHosts[0]' has invalid value "example.com:99999": the port must be a number from 1 to 65535 without a leading zero.
allowed_hosts: ['https://example.com']
  Configuration section 'security' field 'allowedHosts[0]' has invalid value "https://example.com": drop the scheme, list the host only, such as example.com.
csrf: true
  Configuration section 'security' field 'csrf' must be a mapping, such as csrf: { enabled: false }.
trusted_proxies: ['10.0.0.1/8']
  Configuration section 'security' field 'trustedProxies[0]' has invalid value "10.0.0.1/8": 10.0.0.1/8 covers 10.0.0.0/8; write 10.0.0.1/32 or 10.0.0.0/8.
```

A list key may also come from one environment variable holding a comma-separated value: with `HOSTS=app.example.test, www.example.test`, `allowed_hosts: !env HOSTS` reads as two entries. Secrets, such as the encryption key, always come from the environment (`!env`), never written into the file.

## CSRF protection

A cross-site request forgery is a form on another site that posts to yours: the browser attaches your user's session cookie, and without a check your application would act on it. `CsrfMiddleware` stops it with a synchronizer token: a random value stored in the session, which every state-changing request must send back.

- `GET`, `HEAD`, `OPTIONS` and `TRACE` pass without a token. Keep them free of side effects.
- Every other method needs the token, read from the `_csrf_token` body field, or from the `X-CSRF-Token` header when that field is absent.
- A request that matches no route is never refused: its 404 or 405 is answered instead, since no handler runs.

`SessionCsrfTokenManager` stores a 64-character hex token in the session the first time it is asked for one, and compares submissions in constant time.

### The token in a form

There is no automatic injection into your HTML. Register a Latte function in the bootstrap (the `csrfToken` line above), then render the hidden field in every form that changes state:

```latte
<form method="post" action="/notes">
    <input type="hidden" name="_csrf_token" value="{csrfToken()}">
    <textarea name="body"></textarea>
    <button>Save</button>
</form>
```

### The token in a JavaScript request

Put the token in the page once, and send it in the `X-CSRF-Token` header:

```latte
<meta name="csrf-token" content="{csrfToken()}">

<script nonce="{nonce()}">
    const token = document.querySelector('meta[name="csrf-token"]').content;

    fetch('/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify({ body: 'Saved from JavaScript' }),
    });
</script>
```

The `nonce` attribute is for the [Content-Security-Policy](../../digging-deeper/content-security-policy/); drop it if you do not send one.

### Refusals

A missing or wrong token is a 403, and the handler never runs. A client whose `Accept` header lists `text/html` (a browser posting a form) gets a plain-text page:

```text
This form could not be verified. Your session may have expired or not been saved. Reload the page and try again.
```

Every other client gets JSON: `{"error":"Invalid or missing CSRF token."}`. To render your own page, pass `onFailure`. It receives the request and a `CsrfFailure` (`CsrfFailure::TokenMissing` or `CsrfFailure::TokenInvalid`); returning `null` keeps the default answer:

```php
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Security\CsrfConfig;
use Zephyrus\Security\CsrfFailure;
use Zephyrus\Security\CsrfMiddleware;

$builder = $builder->withMiddleware(new CsrfMiddleware(
    $tokens,
    CsrfConfig::fromSecurityConfig($config->security),
    onFailure: fn (Request $request, CsrfFailure $failure): ?Response
        => str_contains($request->headers()->get('Accept') ?? '', 'text/html')
            ? Response::html('<h1>This page expired. Reload it and try again.</h1>', 403)
            : null,
));
```

The callback answers a request an attacker may have forged: only render the refusal, never replay the request or act on the account.

### Exempting a path

A route that other servers call (a payment provider's webhook) cannot carry your session's token. List it under `csrf.exceptions`:

```yaml
security:
  csrf:
    enabled: true
    exceptions:
      - '#^/webhooks/#'
      - '#^/csp-reports$#'
```

Each entry is a PCRE pattern matched against the request path, and the rules keep it from exempting more than you meant:

- Quote it. In YAML an unquoted `#` starts a comment, and the entry reads as null. Loading the file refuses it: `Configuration section 'security' field 'csrfExceptions[0]' has invalid value null: each entry must be a non-empty string; quote a pattern that starts with "#" in YAML.`
- Anchor it with `^`, or it could match in the middle of a path.
- End it with `/` (the route and everything under it) or `$` (that exact path), or it would also exempt `/webhooksettings`.

The file loads with either of the last two mistakes. They are refused when `CsrfConfig::fromSecurityConfig()` builds the middleware configuration (in `application()`, so at boot, before the first request), with an `InvalidArgumentException`:

```text
security.csrf.exceptions[0] must start with "^" so it cannot match in the middle of a path: #/x/# (expected a shape such as #^/webhooks/#).
security.csrf.exceptions[0] must end with "/" (the route and everything under it) or "$" (that exact path), otherwise it also exempts every sibling route sharing the prefix: #^/webhooks# (expected a shape such as #^/webhooks/#).
```

A pattern that is not a valid regular expression is refused the same way, with PHP's reason in the parentheses, even under an error handler that turns every warning into an exception: `security.csrf.exceptions[0] is not a valid regex: #^/hooks/(# (Compilation failed: missing closing parenthesis at offset 9; expected a shape such as #^/webhooks/#).` A control character in the quoted pattern is escaped (`\n`, `\u0085`), so the refusal stays on one log line.

An exempt route has lost its CSRF protection, so it must authenticate its caller another way, typically by verifying a signature: the [authentication page](../authentication/#verifying-a-webhook-signature) shows one.

### CsrfConfig

`CsrfConfig::fromSecurityConfig($config->security)` reads `csrf.enabled` and `csrf.exceptions`, which is what the wiring check expects. Built by hand, `new CsrfConfig()` takes `bodyField` (default `_csrf_token`), `headerName` (default `X-CSRF-Token`), `excludedPathPatterns` and `enabled`; `CsrfConfig::defaults()` is the same as `new CsrfConfig()`. `CsrfConfig::fromArray()` reads the same settings from an array and refuses unknown keys.

To use another token store, implement `CsrfTokenManagerInterface`: `getToken(): string` and `isTokenValid(string $submitted): bool`, the latter compared in constant time.

### Good to know

- Rotate the token when a user signs in, with the session id: the [authentication page](../authentication/#signing-in) shows both calls.
- `security.csrf.auto_html` and `new CsrfConfig(injectToken: true)` are refused: injecting the token into HTML on the way out cannot follow the browser's parsing and could send it to another site.
- `csrf: { enabled: false }` turns the check off without mounting anything. Do that only for an application with no cookie-based session.
- The middleware does not check the `Origin` header or use `SameSite` cookies in its place. The session cookie's `same_site: Lax` (see [sessions](../sessions/)) is a second layer, not a replacement.

## Security headers

`SecureHeadersMiddleware` adds the security response headers. With no `headers:` section, `SecureHeadersConfig::defaults()` applies:

| Header | Default | Key | Why |
| --- | --- | --- | --- |
| `X-Frame-Options` | `SAMEORIGIN` | `x_frame_options` | Other sites cannot frame your pages (clickjacking). Use `DENY` if you never frame your own. |
| `X-Content-Type-Options` | `nosniff` | `x_content_type_options` | Browsers trust your `Content-Type` instead of guessing. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `referrer_policy` | Paths and query strings stay on your site. |
| `X-XSS-Protection` | `0` | `xss_protection` | The legacy filter is off: it could be abused to remove scripts from a page. |
| `Strict-Transport-Security` | not sent | `hsts_max_age`, `hsts_include_subdomains` | Off until you set a max age, because it binds browsers to HTTPS for that long. |
| `Content-Security-Policy` | not sent | `csp` | No policy is safe for every application. |
| `Permissions-Policy` | not sent | `permissions_policy` | Opt in per browser feature. |

A key you set replaces its default; a key you leave out keeps it. An empty value (`''`) means the header is not sent. The configuration at the top of this page sends:

```text
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: same-origin
x-xss-protection: 0
permissions-policy: camera=(), microphone=(), geolocation=()
strict-transport-security: max-age=31536000
```

`hsts_include_subdomains: true` appends `; includeSubDomains`. Turn HSTS on once every page of the domain is served over HTTPS, and include subdomains only when every subdomain is too.

`csp` sends one static policy. For a policy with per-request nonces, leave `csp` empty and use [ContentSecurityPolicyMiddleware](../../digging-deeper/content-security-policy/). A multi-line `csp` is refused: write it on one line or with a folded block (`>`).

### Good to know

- `Strict-Transport-Security` is only sent on HTTPS requests. Behind a proxy that terminates TLS, the request only counts as HTTPS when the proxy is trusted (see below).
- A header the route already set wins, including a looser one: a route that needs to be framed by a partner sets its own `X-Frame-Options` or policy. A route's `Content-Security-Policy` replaces the configured one whole; they are not merged. A blank header set by a route does not opt out.
- Build the config with `SecureHeadersConfig::defaults()` or `SecureHeadersConfig::fromArray([...])` when you mount the middleware without a configuration file; with a `headers:` section declared, pass `$config->security->headers`.

## Forcing HTTPS

`ForceHttpsMiddleware` answers a plain HTTP request with a 308 redirect to the same host, path and query over HTTPS: `http://app.example.test/notes?page=2` goes to `https://app.example.test/notes?page=2`. A 308 keeps the method and body, so a misdirected `POST` is not silently turned into a `GET`. The constructor takes no argument.

The scheme comes from the server (`HTTPS`, `SERVER_PORT`) or from a [trusted proxy](#trusted-proxies-and-the-client-ip), never from the request line. A client that sends an absolute target over plain HTTP (`GET https://evil.example/x HTTP/1.1`) keeps only the path and query, under the `Host` it sent: the request reads as `http://app.example.test/x` and is redirected like any other.

Behind a load balancer or reverse proxy that terminates TLS, PHP sees plain HTTP. Unless the proxy is listed in `trusted_proxies`, every request looks insecure and the middleware redirects forever. Either list the proxy, or let the proxy do the redirect and acknowledge the key with `withAcknowledgedSecurityKeys(['forceHttps'])`.

## Allowed hosts

The `Host` header is chosen by the client. An application that builds absolute links from it (a password reset email, a canonical URL, a redirect) can be made to send your users to an attacker's domain. `AllowedHostsMiddleware` refuses any host outside your list with a 400 and `{"error":"Invalid Host header."}`.

```yaml
security:
  allowed_hosts:
    - app.example.test
    - '*.example.com'
```

- An exact entry matches that host, case-insensitively. A trailing dot is ignored.
- `*.example.com` matches every subdomain, at any depth (`www.example.com`, `a.b.example.com`), but never `example.com` itself: list both if you need both.
- An IPv6 literal is written `2001:db8::1` or `[2001:db8::1]`.
- An entry without a port admits any port: `app.example.test:8443` passes when `app.example.test` is listed. An entry with a port pins it: `app.example.test:443`, `[2001:db8::1]:8080` or `*.example.com:443` admits that port only, and a URL without a port counts as 80 for `http` and 443 for `https`. Pin the port in production when the application builds absolute URLs from the request. An IPv6 literal pins a port only in brackets: `::1:8080` is an address, admitted on any port.
- Behind `ForceHttpsMiddleware`, also list the host on port 80, which then only reaches the redirect: with `[app.example.test:443, app.example.test:80]`, `http://app.example.test/` is answered with a 308, and with `[app.example.test:443]` alone, with a 400.
- Entries with a scheme, a port outside 1 to 65535, a lone `*` or a non-ASCII name are refused at boot (use the punycode form of an internationalised name).
- An empty list accepts every host. In production, list yours.

`$middleware->allows('www.example.com')` applies the same rules outside a request, for example to check a host read from somewhere else.

## Trusted proxies and the client IP

Behind a reverse proxy, `REMOTE_ADDR` is the proxy's address, and the real client and scheme travel in forwarding headers that any client can also send. `Request::fromGlobals()` reads those headers only when the direct peer is in `trusted_proxies`:

```yaml
security:
  trusted_proxies: [10.0.0.5/32]
```

List the narrowest range that covers your proxies. A wide one such as `10.0.0.0/8` on a shared network lets any internal host forge `X-Forwarded-For` and the other headers below. For a request from the proxy `10.0.0.5` carrying `X-Forwarded-For: 203.0.113.9` and `X-Forwarded-Proto: https`:

| `trustedProxies` passed to `fromGlobals()` | `clientIp()` | scheme |
| --- | --- | --- |
| none | `10.0.0.5` | `http` |
| `['10.0.0.5/32']` | `203.0.113.9` | `https` |

The forwarded chain is read from the right, skipping trusted proxies, and the first untrusted address is the client. When the nearest proxy appends to `X-Forwarded-For`, a client that sends its own `X-Forwarded-For: 1.2.3.4` only adds an entry on the left, which is never reached: the answer stays `203.0.113.9`. A proxy that forwards the client's header untouched leaves the client's value as the only entry, and the client then picks `clientIp()`. A client connecting directly (not through a trusted proxy) keeps its own address, whatever headers it sends.

`trusted_headers` lists which forwarding headers a trusted proxy may set: by default `x-forwarded-for`, `x-forwarded-host`, `x-forwarded-proto` and `x-forwarded-port`. `forwarded`, `x-real-ip`, `cf-connecting-ip` and `x-client-ip` are also understood, but only read when you list them, because they are only trustworthy when your nearest proxy overwrites them. Listing `trusted_headers` replaces the default set, so name every header you need.

The default set is not safe behind every proxy. `x-forwarded-for` is read from the right, so a value the client prepends is never reached, provided the nearest proxy appends to the header or overwrites it. `x-forwarded-host`, `x-forwarded-proto` and `x-forwarded-port` are read from their last entry, the one the nearest proxy wrote, and an empty last entry counts as absent. With a trusted peer forwarding `X-Forwarded-Host: evil.example, app.example.test` and `X-Forwarded-Proto: https, http`, `Request::uri()` answers `http://app.example.test/`: the client's value is never reached. The proxy must still write each of these headers on every request, by overwriting or appending. One that writes a header only sometimes lets the client choose it: a request that reaches the application with `X-Forwarded-Host: evil.example` alone yields `http://evil.example/`, and with an empty `allowed_hosts` a password reset link built from it points at `evil.example`. Version 0.14.0 read the first entry instead, which the client supplies even through an appending proxy, so there the proxy had to overwrite them.

So the forwarding headers are trustworthy only when the nearest proxy writes them on every request. A proxy that passes the client's `X-Forwarded-For` through lets the client choose `clientIp()` and get past `IpAllowlistGuard`. In nginx:

```nginx
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Port $server_port;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Apache `mod_proxy` appends `X-Forwarded-Host` only when the request has a `Host` (an HTTP/1.0 request without one keeps the client's value) and never writes `X-Forwarded-Proto` or `X-Forwarded-Port`. Add `RequestHeader unset X-Forwarded-Host early`, `RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}` and, in each vhost, `RequestHeader set X-Forwarded-Port` with the port it listens on (`443` for TLS, `80` otherwise). Behind two appending proxies the value read is the nearest one's: if the outer proxy rewrote `Host`, that is the internal name, so `allowed_hosts` refuses it, and the outer proxy should overwrite instead. When a proxy does not write a header, take it out of the trusted set. With only the client address trusted, a request that carries `X-Forwarded-Host: evil.example` resolves to `http://app.example.test`:

```yaml
security:
  trusted_proxies: [10.0.0.5/32]
  trusted_headers: [x-forwarded-for]
```

Without `x-forwarded-proto`, a request that a proxy terminated over TLS is no longer seen as HTTPS, so enforce HTTPS at the proxy and acknowledge `forceHttps` (see [forcing HTTPS](#forcing-https)). `allowed_hosts` is the backstop for every host header, forwarded or not: list your hosts in production. With `app.example.test` listed, a request whose host resolves to `evil.example` is answered with a 400. An entry without a port does not check ports: pin the port (`app.example.test:443`) so that a client cannot put its own port, through `X-Forwarded-Port` or the `Host` header, into a URL built from the request. Still build the links you send by email (password resets, invitations) from a configured base URL, never from the request.

`['*']` trusts every peer. It exists for local development behind a container proxy; in production it lets any client choose its own address.

### IpRange

`Zephyrus\Http\IpRange` is the matcher behind `trusted_proxies` and the [IP allowlist guard](../authentication/#the-built-in-guards):

```php
use Zephyrus\Http\IpRange;

IpRange::contains('10.0.0.0/8', '10.20.30.40');   // true
IpRange::contains('2001:db8::/32', '2001:db8::1'); // true
IpRange::contains('192.0.2.10', '192.0.2.10');     // true: no prefix means an exact match
IpRange::contains('10.0.0.0/8', 'not-an-ip');      // false: unparsable input never matches
IpRange::isValid('10.0.0.1/8');                    // false
IpRange::invalidEntryReason('10.0.0.1/8');         // "10.0.0.1/8 covers 10.0.0.0/8; write 10.0.0.1/32 or 10.0.0.0/8"
```

A range with bits set after its prefix (`10.0.0.1/8`) is refused, since it rarely means what it says, and so is an IPv4-mapped IPv6 range shorter than `/96` (`::ffff:10.0.0.0/8` covers far more than `10.0.0.0/8`).

## Request body size

`MaxBodySizeMiddleware` refuses a request whose body is larger than its limit, before the session starts and before your route runs:

```php
$builder = $builder->withMiddleware(new MaxBodySizeMiddleware($config->security->maxBodySize));
```

It measures the largest of three sizes: the declared `Content-Length` when it is valid, the raw body, and the uploaded files. When the raw body is empty, which is what a body PHP parsed itself looks like (a multipart form, whatever its `Content-Type`), the keys and values of the text fields count too. A request that declares a short length and sends more, or an upload whose files are larger than its declared length, is measured by what arrived. A body of exactly the limit passes. The refusal is a 413: plain text (`Request body too large.`) when the `Accept` header lists `text/html`, otherwise `{"error":"Request body too large."}`. The second argument replaces that message, so write it in your users' language:

```php
$builder = $builder->withMiddleware(new MaxBodySizeMiddleware(
    $config->security->maxBodySize,
    'This file is larger than the 1 MB limit.',
));
```

To answer yourself, pass `onFailure`. It receives the request and a `BodyTooLarge` carrying `bytes` (the measured or declared size) and `maxBytes`; returning `null` keeps the default answer:

```php
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Security\BodyTooLarge;
use Zephyrus\Security\MaxBodySizeMiddleware;

$builder = $builder->withMiddleware(new MaxBodySizeMiddleware(
    $config->security->maxBodySize,
    onFailure: fn (Request $request, BodyTooLarge $refusal): ?Response
        => Response::html('<h1>That file is too large (limit ' . $refusal->maxBytes . ' bytes).</h1>', 413),
));
```

Give `Request::fromGlobals()` the same limit, as the [bootstrap](#a-secure-bootstrap) does with `maxBodySize: $config->security->maxBodySize`. Without it, `fromGlobals()` reads at most 2 MB (`Request::MAX_BODY_SIZE_DEFAULT`, 2097152 bytes), so `maxBodySize` is required as soon as your limit is above 2 MB: otherwise bodies between 2 MB and your limit are refused, and each one is reported as a `ConfigurationException` that names the fix. An application that declares no `max_body_size` but accepts bodies over 2 MB (a limit set only by `post_max_size`) is refused the same way, with no report: pass the limit it accepts. `php://input` is read at most one byte past the limit: a valid `Content-Length` over the limit leaves the raw body empty, and a body that runs over it arrives unparsed (`$request->body()->all()` is empty, `isTruncated()` and `isMalformed()` are true). Such a body never reaches a controller: a global `MaxBodySizeMiddleware` refuses it through its `onFailure` or its default 413, whatever its own limit, and without that middleware the kernel answers the default 413. `maxBodySize: 0` reads the whole body, and a negative value is refused (`Maximum body size must be 0 (unlimited) or a positive byte count.`).

### Good to know

- This is a budget, not a defence. By the time PHP runs, the web server has already read the body. Set the server's own limit (`client_max_body_size` in nginx, `LimitRequestBody` in Apache) and PHP's `post_max_size` and `upload_max_filesize` as well.
- PHP reads a multipart form or an upload into `$_POST` and `$_FILES` itself, up to `post_max_size`, before `fromGlobals()` runs: the `maxBodySize` argument cannot shorten that read. Set `post_max_size` to the same budget.
- A form sent without a valid `Content-Length` (sent with `Transfer-Encoding: chunked`, or declaring fewer bytes than it sends) is measured by its text fields and files, by `fromGlobals()` against its read limit and by the middleware against its own, and refused with a 413 when they exceed it. Version 0.16 let it through. If a legitimate form is refused, raise `max_body_size` (and `post_max_size`) or shorten its fields.
- `bytes` repeats what the client declared and may be absurdly large. Show `maxBytes` to the user, not `bytes`.
- `new MaxBodySizeMiddleware(0)` is unlimited; a negative limit is refused.

## Production checklist

Before the first deploy, and again whenever the configuration changes:

- `application.debug` is off. `build()` turns it off anyway when `environment` is `production` or `staging` (an unrecognized name counts as production), unless the bootstrap calls `withProductionDebugAcknowledged()`. To see debug output from one machine, use the debug client allowlist described on the [errors page](../errors/).
- `force_https: true`, or HTTPS enforced at the load balancer and acknowledged with `withAcknowledgedSecurityKeys(['forceHttps'])`.
- `hsts_max_age` set once every page is served over HTTPS.
- `allowed_hosts` lists your host names.
- `trusted_proxies` lists your proxies, never `'*'`, and is passed to `Request::fromGlobals()`.
- `max_body_size` matches what your forms need, is passed to `Request::fromGlobals()` as `maxBodySize` (required above 2 MB), and the web server and `post_max_size` limits are set too.
- Every form that changes state renders the `_csrf_token` field, and every `csrf.exceptions` entry authenticates its caller another way.
- The session cookie is `secure` and `http_only` (see [sessions](../sessions/)), and the session id and CSRF token are rotated at sign-in.
- Secrets (`encryption.key`, database password, API tokens) come from `!env`, not from the file.
- A Content-Security-Policy is sent, at least in report-only mode while you tune it.
- The application boots with no `withoutSecurityWiringCheck()`, and each acknowledged key names a protection you can point to.
