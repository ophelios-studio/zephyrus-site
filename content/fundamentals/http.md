---
title: HTTP
order: 6
description: Read requests through typed accessors, build immutable responses, and emit them to the PHP SAPI.
---

# HTTP

Every response, explicit.

`Request` and `Response` are the two value objects every part of Zephyrus passes around. A request is read through small typed parts; a response is built once and never changed in place: every `with*()` method returns a copy.

## Building a request

In `public/index.php`, build the request from the PHP superglobals:

```php
use Zephyrus\Http\Request;

$request = Request::fromGlobals(
    trustedProxies: $config->security->trustedProxies,
    trustedHeaders: $config->security->trustedHeaders,
);
```

`fromGlobals()` does not read `config.yml`: pass the proxy settings yourself (see [Security](../security/) for what a trusted proxy changes). In a test, or anywhere outside a web request, use `fromArray()`:

```php
$request = Request::fromArray(
    'POST',
    'https://app.example.test:8443/api/items?sort=name&tags[]=a&tags[]=b#x',
    body: ['name' => 'Atlas'],
    headers: ['Content-Type' => 'application/json', 'X-Request-Id' => 'abc', 'Authorization' => 'Bearer t0k'],
    cookies: ['theme' => 'dark'],
    clientIp: '203.0.113.9',
);
```

## Method, path and URI

```php
$request->method;                // 'POST' (a property, always upper-case)
$request->isMethod('post');      // true (case-insensitive)
$request->path();                // '/api/items'
$request->uri()->scheme();       // 'https'
$request->uri()->host();         // 'app.example.test'
$request->uri()->port();         // 8443
$request->uri()->queryString();  // 'sort=name&tags[]=a&tags[]=b'
$request->uri()->fragment();     // 'x'
$request->uri()->isSecure();     // true
$request->uri()->baseUrl();      // 'https://app.example.test:8443'
$request->uri()->full();         // the whole URL
```

Use `path()` for decisions such as guards and allowlists: it is the path as sent, still percent-encoded, which is what the router matches. `uri()->path()` is for display. A parameter segment stays encoded in `path()`; read its decoded value with `routeParameter()`.

From `fromGlobals()`, a `POST` carrying a `_method` field or an `X-HTTP-Method-Override` header of `PUT`, `PATCH` or `DELETE` is routed as that method. `fromArray()` does not apply the override.

## Query string

```php
$request->query('sort');            // 'name'
$request->query('tags');            // ['a', 'b']
$request->query('missing', 'dflt'); // 'dflt'
$request->query;                    // the whole array
```

Values are strings or arrays of strings: cast and validate them before use.

## Body

`body()` returns a `RequestBody`: the parsed form fields or JSON object, plus the raw string.

```php
$request->body()->get('name');   // 'Atlas'
$request->body()->get('age', 0); // default when absent
$request->body()->has('name');   // true
$request->body()->all();         // ['name' => 'Atlas']
$request->body()->isEmpty();     // false
$request->body()->raw();         // the body exactly as received
$request->body()->isMalformed(); // true when a JSON body could not be decoded
```

A JSON body is read when the request's `Content-Type` is `application/json` (or a `+json` type). A malformed JSON body reads as empty, so check `isMalformed()` before validating and answer 400 yourself. `raw()` is what you need to verify a webhook signature.

`getParameter($name)` reads the body first, then the query string, and `getParameters()` merges both: convenient for forms that accept either, but explicit `query()` and `body()` calls say where a value comes from.

## Headers

`headers()` returns a case-insensitive `HeaderBag`:

```php
$request->headers()->get('x-request-id');   // 'abc'
$request->headers()->has('X-REQUEST-ID');   // true
$request->headers()->bearerToken();         // 't0k'
$request->headers()->contentType();         // 'application/json'
$request->headers()->isJson();              // true
$request->headers()->all();                 // every header, lower-cased names
$request->getHeader('X-Missing', 'fallback'); // shortcut with a default
```

`bearerToken()` returns the token after `Bearer ` in `Authorization`, or `null`. Pass another header name or prefix as arguments for a custom scheme.

## Cookies

`cookies()` returns a read-only `CookieJar` of the cookies the browser sent:

```php
$request->cookies()->get('theme');       // 'dark'
$request->cookies()->get('x', 'none');   // default
$request->cookies()->has('theme');       // true
$request->cookies()->all();              // ['theme' => 'dark']
```

The session cookie is managed for you by the [session middleware](../sessions/). Set one on a response with `withCookie()`: see [Cookies on a response](#cookies-on-a-response).

## Uploaded files

```php
$request->file('avatar');      // ?FileUpload
$request->filesOf('photos');   // list of FileUpload for a multi-file field
```

Storing an upload safely is the job of `Uploader`: see [Uploads](../../digging-deeper/uploads/).

## Route parameters and attributes

Attributes carry data a middleware computed for the handler. Requests are immutable, so adding one returns a new request:

```php
$next = $request->withAttribute('userId', 7);

$request->attribute('userId');       // null (the original is unchanged)
$next->attribute('userId');          // 7
$next->attribute('userId', 0);       // with a default
$next->withAttributes(['a' => 1]);   // several at once
```

The placeholders a route took from its URL are available through `routeParameter('id')`, and `isRouteParameter('id')` tells you whether a value came from the URL. Placeholders are also merged into attributes, so an authorization check keyed on an attribute must test `isRouteParameter()` first: a URL value says nothing about who the caller is. `route()` returns the matched `Route`, or `null` before routing.

## Client IP

```php
$request->clientIp();            // '203.0.113.9' (or null)
$request->clientIp('0.0.0.0');   // with a default
```

Behind a reverse proxy the value is the forwarded client only when the proxy is declared trusted, which is configured in [Security](../security/). A forwarding header from an untrusted peer is ignored.

## Building a response

The factories cover the common cases:

```php
use Zephyrus\Http\Response;

Response::text('hello');                 // text/plain; charset=utf-8
Response::html('<p>hi</p>', 201);        // text/html; charset=utf-8
Response::json(['ok' => true], 201);     // application/json; charset=utf-8
Response::noContent();                   // 204, empty
Response::redirect('/login', 303);       // Location header, empty body
Response::localRedirect($next, '/');     // only to a local path, else the fallback
```

The constructor builds any other response: `new Response(body: $csv, status: 200, headers: ['Content-Type' => 'text/csv'])`. A response body is a string held in memory; to stream, see [Server-sent events](../../digging-deeper/server-sent-events/).

`Response::json()` throws when the payload cannot be encoded (for example invalid UTF-8) rather than sending broken JSON.

`redirect()` sends wherever you tell it: never pass it a value from the request. `localRedirect()` accepts a target only when `Response::isLocalPath()` approves it: one leading `/`, not `//`, no backslash, no control character. Anything else (`//evil.example`, `https://evil.example`, a non-string) goes to the fallback, and a fallback that is not itself local throws `InvalidArgumentException`.

## Status and headers

```php
$response = Response::html('<p>hi</p>', 201);

$response->status;           // 201
$response->statusPhrase();   // 'Created'
$response->toStatusLine();   // 'HTTP/1.1 201 Created'

$changed = $response
    ->withHeader('X-A', '1')
    ->withHeaders(['X-B' => '2', 'X-C' => '3'])
    ->withoutHeader('x-a')
    ->withStatus(202);

$changed->hasHeader('X-B');        // true
$changed->getHeader('x-b');        // '2' (any case)
$changed->toHeaderLines();         // ['content-type: text/html; charset=utf-8', 'x-b: 2', 'x-c: 3']
```

Header names are stored lower-cased, so `$response->headers['X-B']` is `null` while `$response->headers['x-b']` is `'2'`: use `getHeader()`.

`withHeader()` and `withHeaders()` validate what you give them. A name with a space throws `Invalid HTTP header name "Bad Name": a field name may only contain RFC 9110 token characters.`; a value with a line break throws `Invalid value for HTTP header "X-A": it contains a control character other than HTAB.` This closes header injection when a value comes from user input. To check a value first, use `Response::isValidHeaderValue($value)`.

## Immutability

A `Response` is read-only: assigning to `$response->status` is an error, and every `with*()` method returns a new object. The original is never changed.

```php
$base = Response::text('hi');
$cached = $base->withHeader('Cache-Control', 'no-store');

$base->hasHeader('Cache-Control');   // false
$cached->hasHeader('Cache-Control'); // true
```

The same is true of `Request`: `withAttribute()` returns a copy. A middleware that decorates must return the new object.

## Cookies on a response

`withCookie()` returns a copy of the response that sets one cookie on its own `Set-Cookie` line. Call it once per cookie:

```php
$response = Response::noContent()
    ->withCookie('theme', 'dark', maxAge: 31_536_000) // maxAge: 0 expires it
    ->withCookie('lang', 'fr', secure: $request->uri()->isSecure());

$response->cookies;
// ['theme=dark; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Lax',
//  'lang=fr; Path=/; HttpOnly; SameSite=Lax']
```

The defaults are `Path=/; Secure; HttpOnly; SameSite=Lax`, and the value is percent-encoded as `setcookie()` does. `Secure` stays on even where `session.secure` is `auto`: on plain-HTTP development, pass `secure: false` (or `secure: $request->uri()->isSecure()`), or the browser drops the cookie. A cookie of the same name, domain and path replaces the earlier one (the domain is compared without case or a leading dot); the same name on another domain or path is kept as its own line. `$response->cookies` lists the lines, and `new Response(cookies: [...])` takes a list of lines, never a name-to-value map.

Anything browsers would drop is refused with an `InvalidArgumentException`:

```php
$response->withCookie('sid', 'x', sameSite: 'None', secure: false);
// Cookie "sid" cannot use SameSite=None without Secure: browsers discard it.
$response->withCookie('__Host-sid', 'x', path: '/app');
// Cookie "__Host-sid" uses the __Host- prefix, which requires Secure, the path "/" and no domain.
```

`hasHeader('Set-Cookie')` is true when the response only carries cookies, and `withoutHeader('Set-Cookie')` also clears them; `getHeader('Set-Cookie')` still reads only a header set with `withHeader()`. The emitter adds each `Set-Cookie` line instead of replacing the ones PHP already queued, so the session cookie and any earlier `setcookie()` call survive. Build the value from trusted data only. For login state use the session, which sets its own cookie.

In 0.14.0 `Response` had no cookie API, and a `Set-Cookie` header on a response replaced every cookie PHP had queued, the session cookie included.

## Emitting a response

`Application::handle()` returns a `Response`; something has to send it. The usual front controller:

```php
use Zephyrus\Http\SapiEmitter;

(new SapiEmitter())->emit($app->handle(Request::fromGlobals()));
```

`SapiEmitter` writes the status line and headers, then the body in chunks (8192 bytes by default; `new SapiEmitter(chunkSize: 4096)` changes it, and a size below 1 throws `InvalidArgumentException`). If headers were already sent, it skips them and writes the body. `$response->send()` does the same in one call without the chunking.

`EmitterInterface` has a single method, `emit(Response $response): void`. Implement it for a test double that captures the response in memory instead of writing to the SAPI.

## Good to know

- `fromArray()` is for tests: it does not parse a raw JSON body (build a `RequestBody` with `malformed: true` to test that case) and does not apply the method override.
- `$request->query` and `$request->attributes` are public arrays, but read them through `query()` and `attribute()` and never write to them: use `withAttribute()`.
- Response header names are lower-cased on storage: use `getHeader()` and `hasHeader()` rather than the `headers` array when the case matters.
- Never pass a request value to `redirect()` or to a header: use `localRedirect()` and the validating `withHeader()`.
- A malformed JSON body reads as empty: check `isMalformed()`.
- The client IP is only as trustworthy as your trusted-proxy configuration.
