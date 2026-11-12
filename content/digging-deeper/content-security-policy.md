---
title: Content-Security-Policy
order: 2
description: Send a Content-Security-Policy with a fresh nonce on every request, use the nonce in Latte templates, start in report-only mode and tighten the policy step by step.
---

# Content-Security-Policy

Only the scripts you meant to run.

A Content-Security-Policy tells the browser where a page may load scripts, styles, images and frames from. Its main job is to limit cross-site scripting: if an attacker manages to put a `<script>` into your HTML, a policy that only allows your own scripts keeps the browser from running it.

Zephyrus gives you two classes: `ContentSecurityPolicy`, an immutable builder for the header value, and `ContentSecurityPolicyMiddleware`, which sends it and adds a fresh nonce to every request.

## A starting policy

```php
use Zephyrus\Security\ContentSecurityPolicy;
use Zephyrus\Security\ContentSecurityPolicyMiddleware;
use Zephyrus\Security\SecureHeadersMiddleware;

$policy = ContentSecurityPolicy::create()
    ->withDirective('default-src', "'self'")
    ->withDirective('script-src', "'self'")
    ->withDirective('style-src', "'self'")
    ->withDirective('img-src', ["'self'", 'data:'])
    ->withDirective('connect-src', "'self'")
    ->withDirective('object-src', "'none'")
    ->withDirective('base-uri', "'none'")
    ->withDirective('form-action', "'self'")
    ->withDirective('frame-ancestors', "'none'");

$builder = $builder
    ->withMiddleware(new SecureHeadersMiddleware($config->security->headers))
    ->withMiddleware(new ContentSecurityPolicyMiddleware($policy, nonceDirectives: ['script-src']));
```

Every response then carries a header such as:

```text
content-security-policy: default-src 'self'; script-src 'self' 'nonce-Sfgc2xN1mst83eLYCnU1LA=='; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

What each directive does here:

| Directive | Value | Effect |
| --- | --- | --- |
| `default-src` | `'self'` | Anything without its own directive loads from your origin only. |
| `script-src` | `'self'` and the nonce | Script files from your origin, and inline scripts carrying this request's nonce. |
| `style-src` | `'self'` | Stylesheets from your origin; inline `<style>` and `style=""` are blocked. |
| `img-src` | `'self' data:` | Images from your origin and inline `data:` images. |
| `connect-src` | `'self'` | `fetch()` and `XMLHttpRequest` to your origin only. |
| `object-src` | `'none'` | No plugins (`<object>`, `<embed>`). |
| `base-uri` | `'none'` | No `<base>` tag, which could redirect every relative URL. |
| `form-action` | `'self'` | Forms post to your origin only. |
| `frame-ancestors` | `'none'` | No site may frame your pages (the modern form of `X-Frame-Options: DENY`). |

Add a source where your application needs one, for example `->appendValue('img-src', 'https://images.example.com')` for an image host.

## Nonces in templates

A nonce is a random value the server puts both in the header and on each script tag it trusts. An injected script cannot guess it, so the browser refuses to run it. Put `nonce()` on every `<script>` tag, inline or not:

```latte
<!doctype html>
<html lang="en">
<head>
    <link rel="stylesheet" href="/css/app.css">
    <script nonce="{nonce()}" src="/js/app.js" defer></script>
</head>
<body>
    <button type="button" id="save">Save</button>
    <script nonce="{nonce()}">
        document.getElementById('save').addEventListener('click', () => console.log('saved'));
    </script>
</body>
</html>
```

The page renders with the same value as the header:

```text
<script nonce="Sfgc2xN1mst83eLYCnU1LA==" src="/js/app.js" defer></script>
```

- The nonce is 16 random bytes, base64 encoded, minted before your controller runs. `nonce()` returns the same value for every tag of one request, and the next request gets a new one.
- Nothing adds the attribute for you: a tag without it is blocked, which is the point.
- Inline event handlers (`onclick="..."`) and `javascript:` URLs cannot carry a nonce and are blocked. Attach handlers from a script with `addEventListener`, as above.
- To allow nonced inline `<style>` blocks too, list the directive: `nonceDirectives: ['script-src', 'style-src']`.
- Never cache a page carrying a nonce in a shared cache: every visitor would receive the same nonce, and an attacker who reads it once could reuse it.

## Building a policy

`ContentSecurityPolicy` is immutable: every method returns a new policy.

```php
$policy = ContentSecurityPolicy::create()
    ->withDirective('default-src', "'self'")
    ->withDirective('script-src', "'self' https://cdn.example.com") // a string is split on whitespace
    ->withDirective('img-src', ["'self'", 'data:'])                   // or pass an array
    ->appendValue('img-src', 'https://images.example.com')            // adds one source, skips duplicates
    ->withDirective('upgrade-insecure-requests');                     // a directive with no value

$policy->hasDirective('IMG-SRC');      // true: names are case-insensitive
$policy->withoutDirective('img-src');  // a copy without the directive
$policy->toArray();                    // ['default-src' => ["'self'"], 'script-src' => [...], ...]
$policy->toHeaderValue();              // the header value, also what (string) $policy returns
ContentSecurityPolicy::create()->isEmpty(); // true
```

`withDirective()` replaces a directive; `appendValue()` adds to it. Values are checked as they are added, so a policy cannot be broken by a stray character:

```text
->appendValue('script-src', "'self' 'unsafe-inline'")
  A CSP directive value must be a single source expression and cannot contain whitespace.
->withDirective('script-src', "'self'; object-src *")
  CSP directive "script-src" cannot contain a separator (";", CR or LF).
```

### Hashes

A fixed inline snippet you cannot put a nonce on (a third-party tag pasted as is) can be allowed by its hash instead. `appendHash()` takes the algorithm (`sha256`, `sha384` or `sha512`) and the base64 digest of the exact content between the tags:

```php
$policy = $policy->appendHash('style-src', 'sha256', base64_encode(hash('sha256', 'body{margin:0}', true)));
// style-src 'self' 'sha256-IAdwN3biDCQ3brrgp1m8kBEsPQYyqfREKOEfeoREopc='
```

Any change to the snippet, even one space, changes the hash and blocks it. `appendNonce('script-src', $nonce)` exists for a nonce you manage yourself; with the middleware, use `nonceDirectives` instead.

## The middleware

`new ContentSecurityPolicyMiddleware($policy, reportOnly: false, nonceDirectives: [])` takes:

- `$policy`: a `ContentSecurityPolicy`, or a plain string for a policy with no nonce. A string cannot take a nonce: `new ContentSecurityPolicyMiddleware("default-src 'self'", nonceDirectives: ['script-src'])` throws `A nonce requires a ContentSecurityPolicy instance, a raw policy string cannot be extended.`
- `reportOnly`: send `Content-Security-Policy-Report-Only` instead, so the browser reports violations without blocking anything.
- `nonceDirectives`: the directives that receive the request's nonce. Empty (the default) sends the policy as built.

### With SecureHeadersMiddleware

`security.headers.csp` sends one static policy through `SecureHeadersMiddleware` (see [security headers](../../fundamentals/security/#security-headers)). When you use this middleware, leave that key empty. If both are set and this middleware is mounted first, `build()` refuses, since its policy would never be sent:

```text
ContentSecurityPolicyMiddleware is registered before SecureHeadersMiddleware, whose csp is set, so the policy registered first is never sent. Register ContentSecurityPolicyMiddleware after SecureHeadersMiddleware, or leave SecureHeadersConfig::csp empty.
```

### A route with its own policy

A response that already carries the header keeps it. A page meant to be framed by a partner sets its own:

```php
#[Get('/embed')]
public function embed(): Response
{
    return $this->render('page')
        ->withHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors https://partner.example.com");
}
```

That policy replaces the middleware's whole, nonce included: write the complete policy the page needs. With `application.debug` on, the middleware warns on such a route that "the nonce policy was not applied because Content-Security-Policy is already set on the response"; on a route that sets its own policy on purpose, that warning is expected.

## Report-only and violation reports

Turning on a policy over an existing application will block something you forgot. Start in report-only mode: the browser runs everything, and tells you what the policy would have blocked.

```php
$builder = $builder->withMiddleware(new ContentSecurityPolicyMiddleware(
    $policy->withDirective('report-uri', '/csp-reports'),
    reportOnly: true,
    nonceDirectives: ['script-src'],
));
```

```text
content-security-policy-report-only: default-src 'self'; script-src 'self' 'nonce-SYgRgoVRa5R4hJCvw1M8Ew=='; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; report-uri /csp-reports
```

Browsers post each violation as JSON to `report-uri`. The endpoint is called without your CSRF token, so it must be listed under `security.csrf.exceptions`, or every report is refused with a 403:

```yaml
security:
  csrf:
    exceptions: ['#^/csp-reports$#']
```

```php
#[Post('/csp-reports')]
public function report(Request $request): Response
{
    $report = json_decode($request->body()->raw(), true);
    if (is_array($report)) {
        error_log('CSP violation: ' . json_encode($report['csp-report'] ?? $report, JSON_UNESCAPED_SLASHES));
    }

    return $this->noContent();
}
```

Anyone can post to this route: re-encoding the report with `json_encode()` keeps a forged report on one log line, and `MaxBodySizeMiddleware` bounds its size. Do not store or display reports without treating them as untrusted input.

## Tightening the policy

1. Mount the starting policy with `reportOnly: true` and the report route.
2. Browse every page, then read the reports. For each one, move the inline script into a file or give it the nonce, replace inline handlers with `addEventListener`, and add the hosts you really use (`appendValue('img-src', ...)`).
3. When the reports stop, switch to `reportOnly: false`. Keep the `report-uri` directive to hear about what you missed.
4. Then tighten further: keep `'unsafe-inline'` and `'unsafe-eval'` out of `script-src`, add `upgrade-insecure-requests` once everything is served over HTTPS, and with nonces in place consider `->appendValue('script-src', "'strict-dynamic'")`, which lets your nonced scripts load their own dependencies and ignores host allowlists in browsers that support it.

Several `ContentSecurityPolicyMiddleware` that take nonces share one nonce per request: the first mints it, the others and `nonce()` reuse it. An enforced policy and a report-only trial can therefore both name the nonce the page carries:

```php
$kernel = $builder
    ->withMiddleware(new ContentSecurityPolicyMiddleware($enforced, nonceDirectives: ['script-src']))
    ->withMiddleware(new ContentSecurityPolicyMiddleware($trial, reportOnly: true, nonceDirectives: ['script-src']))
    ->build();
```

Both `Content-Security-Policy` and `Content-Security-Policy-Report-Only` then carry the same `'nonce-...'` value as the tags rendered with `nonce()`. Before 0.14.1 each middleware minted its own nonce and `nonce()` returned the innermost one, so the outer header named a nonce no tag carried.

## Good to know

- A nonce or a hash in a directive makes browsers ignore `'unsafe-inline'` in that same directive. With `application.debug` on, the middleware warns about the combination: `Content-Security-Policy: a nonce was added to script-src, which also contains 'unsafe-inline'. Browsers ignore 'unsafe-inline' when a nonce is present, so inline scripts without the nonce attribute will stop running. Remove one of the two.`
- `frame-ancestors` supersedes `X-Frame-Options` in current browsers. Keep both: older browsers only read the second.
- A route cannot skip the middleware with `#[WithoutMiddleware]`; set the route's own header instead, as shown above.
- The policy limits the damage of an injected script; it does not replace escaping. Latte escapes every `{$value}` for its context: keep that the only way data reaches your HTML.
