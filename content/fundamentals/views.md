---
title: Views
order: 7
description: Render Latte or plain PHP templates from a controller, pass data, build layouts, and know what auto-escaping does and does not protect.
---

# Views

Templates in, HTML out.

A controller that uses the `RenderResponses` trait calls `render()` with a template name and an array of variables. The engine behind it is Latte by default, with a plain PHP engine as the alternative.

## Render a template

Mount an engine on the application builder, then render from a controller:

```php
use Zephyrus\Controller\Controller;
use Zephyrus\Http\Response;
use Zephyrus\Rendering\RenderResponses;
use Zephyrus\Routing\Attribute\Get;

final class PageController extends Controller
{
    use RenderResponses;

    #[Get('/', name: 'home')]
    public function home(): Response
    {
        return $this->render('pages/home', ['name' => 'Ada', 'items' => ['one', 'two']]);
    }
}
```

`render('pages/home')` renders `app/Views/pages/home.latte`. The name is a path relative to the views directory, without the extension. The third argument sets the status code, which is how you answer a failed form with a view:

```php
return $this->render('contact', ['errors' => $errors->toArray()], 422);
```

`RenderResponses` gives a controller three methods:

| Method | What it does |
|---|---|
| `render($page, $args = [], $status = 200)` | Renders with the engine mounted on the builder. |
| `renderWith($engine, $page, $args = [], $status = 200)` | Renders with an engine you pass, ignoring the mounted one. |
| `html($content, $status = 200)` | Returns an HTML response from a string you already have. |

Without a mounted engine, `render()` throws a `RenderException`, and the application answers 500. Mount one with `withRenderEngine()` on the builder (see [Application](../application/)); it is injected into every controller that uses the trait.

## Latte

`LatteEngine` is the default. Build it by hand, or from the `render:` configuration section (next part):

```php
use Zephyrus\Rendering\LatteEngine;

$views = new LatteEngine($root . '/app/Views', $root . '/cache/latte');
```

Its arguments are the views directory, the directory for compiled templates, a cache mode and a list of Latte extensions. In cache mode `always` (the default), templates are compiled once into the cache directory and recompiled when the source file changes. In mode `never`, nothing is written to disk. Any other value is refused when the engine is built. The cache directory is created if it does not exist.

A template is plain HTML with Latte tags:

```latte
{layout '../layouts/base.latte'}

{block title}Welcome, {$name}{/block}

{block content}
    <h1>Hello, {$name}</h1>
    <ul>
        {foreach $items as $item}
            <li>{$item}</li>
        {/foreach}
    </ul>
{/block}
```

Latte's own documentation covers the full tag language. These are the tags you will use first.

### Layouts and blocks

A layout declares the blocks a page can fill:

```latte
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{block title}My site{/block}</title>
    <link rel="stylesheet" href="{asset('/css/app.css')}">
</head>
<body>
    {include '../partials/nav.latte'}
    <main>
        {block content}{/block}
    </main>
</body>
</html>
```

A page that starts with `{layout '../layouts/base.latte'}` is rendered inside it, and its `{block}` tags replace the layout's. Everything outside a block in the page is ignored.

Reusable fragments come from `{include 'file.latte'}` for a file, or `{define}` for a fragment inside the same template:

```latte
{define badge $text}<span class="badge">{$text}</span>{/define}

{include badge 'new'}
```

### Paths in layouts and includes

A path in `{layout}` or `{include}` is relative to the template that contains it, not to the views directory. A layout in `layouts/` that includes `partials/nav.latte` fails with `Missing template file '.../layouts/partials/nav.latte'`: write `../partials/nav.latte`.

### Functions and filters

A Latte template can call any PHP function, and the framework ships global helpers that are ready to use:

| Call | Result |
|---|---|
| `{asset('/css/app.css')}` | A cache-busted URL (see [Assets](#assets)). |
| `{route('home')}` | The URL of a named route (see [Routing](../routing/)). |
| `{=embed('/img/logo.svg')}` | The contents of a file under `public/` (see [Assets](#assets)). |
| `{i18n('key')}` or `{localize('key', ['name' => 'Ada'])}` | A translation (see [Localization](../localization/)). |
| `{nonce()}` | The Content-Security-Policy nonce of the request (see [Content Security Policy](../../digging-deeper/content-security-policy/)). |

The formatting helpers become Latte filters once you register them on the engine:

```php
$views->registerFormatterFilters(App::getFormatter());
```

After that, a template can write `{$total|money}`, `{$date|date}` or `{$bytes|filesize}`. The filters are `money`, `date`, `datetime`, `time`, `filesize`, `percent`, `decimal`, `timeago`, `duration`, `list`, `ordinal`, `spellOut` and `truncate`, plus every formatter you register with `$formatter->register()`. Each one is described on [Localization](../localization/). The `money` filter needs a currency, so the configuration must say which one:

```yaml
localization:
  locale: en_CA
  currency: CAD
```

With a locale that has no native currency, such as `en`, the filter throws `Currency required: locale "en" has no native currency...`. With the `en_CA` locale and `CAD` currency above, `{$total|money}` printed `$1,234.50`, `{$date|date}` printed `Mar 9, 2026` and `{$bytes|filesize}` printed `1.0 MB`.

`App::getFormatter()` returns the formatter that `build()` installs, so call `registerFormatterFilters()` after `build()`.

To add a function or filter of your own, or any other Latte extension, use the underlying engine:

```php
$views->getLatteEngine()->addFunction('csrfToken', $tokens->getToken(...));
$views->getLatteEngine()->addFilter('initials', fn (string $name): string => strtoupper($name[0]));
```

`addExtension()` on `LatteEngine` registers a Latte `Extension` the same way. The CSRF field is documented on [Security](../security/): the form needs `{csrfToken()}` registered as above.

## Configure the engine

The `render:` section of `config.yml` describes the engine once. The values shown are the defaults:

```yaml
render:
  engine: latte          # latte or php
  directory: app/Views
  cache: cache/latte
  mode: always           # always or never (Latte only)
  extension: .php        # file extension (PhpEngine only)
```

`render` is not a built-in section, so register its class when you load the configuration, then ask it for an engine:

```php
use Zephyrus\Core\Config\Configuration;
use Zephyrus\Rendering\RenderConfig;

$config = Configuration::fromYamlFile($root . '/config.yml', ['render' => RenderConfig::class]);
$views = $config->section('render')->createEngine($root);
```

The `render:` section must be present in `config.yml`: without it `$config->section('render')` is `null` and `createEngine()` is a fatal error.

`createEngine()` takes the project root and resolves a relative `directory` and `cache` against it; an absolute path is used as it is. It returns a `LatteEngine` or a `PhpEngine`, both implementing `RenderEngine`. An unknown engine name throws a `RenderException`: `Unknown render engine [twig]. Supported engines: latte, php.`

## The PHP engine

`PhpEngine` renders `.php` files. Variables are extracted into the template's scope:

```php
use Zephyrus\Rendering\PhpEngine;

$engine = new PhpEngine($root . '/app/Views/php');
return $this->renderWith($engine, 'hello', ['name' => $name]);
```

```php
<h1>Hello, <?= e($name) ?></h1>
```

The second constructor argument is the file extension, `.php` by default.

**The PHP engine does not escape anything.** `<?= $name ?>` with the value `<b>Ada</b>` prints the tag as markup. Pass every value that reaches HTML through the global `e()` helper, which escapes quotes as well as angle brackets and replaces invalid UTF-8 instead of dropping the value. Prefer Latte when the template is not trivial.

Both engines share the `RenderEngine` interface, with two methods: `render(string $page, array $args = []): string` and `exists(string $page): bool`. Implement it to plug in another engine.

## Escaping

Latte escapes for the context where a value lands: HTML text, an attribute, a URL, a script. With `$comment = '<script>alert(1)</script>'`:

```latte
<p>{$comment}</p>
<input value="{$comment}">
```

prints

```html
<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>
<input value="&lt;script&gt;alert(1)&lt;/script&gt;">
```

A `javascript:` URL in an `href` is replaced by an empty value: `<a href="{$link}">` with `javascript:alert(1)` printed `<a href="">`. Escaping is the default, which is the safe path. These are the places where it stops protecting you:

- `{$html|noescape}` prints the value raw. Use it only on markup you generated or sanitised yourself, never on user input.
- `{=embed('/img/logo.svg')}` is escaped like any other value, so the file would print as text. An SVG you want inline needs `{=embed('/img/logo.svg')|noescape}`, and that is safe only for files you ship, since the file is printed as markup.
- Escaping follows the markup Latte can see. Inside a `<script>` element, `var user = {$user};` prints a JSON literal (an array holding `</script><b>"x"` printed `{"name":"<\/script><b>\"x\""}`), which is safe. Building JavaScript or an inline event handler by concatenating strings around a value is not: Latte escapes the value, not the code you wrote around it.
- Inside the PHP engine nothing is escaped: see above.

## Assets

`Asset` turns a path under your `public/` directory into a URL that changes when the file does, so browsers cache it for as long as it stays the same. Register it once, and the `asset()` helper (and `{asset()}` in Latte) uses it:

```php
use Zephyrus\Core\App;
use Zephyrus\Rendering\Asset;

App::setAsset(new Asset($root . '/public'));
```

```latte
<link rel="stylesheet" href="{asset('/css/app.css')}">
```

prints `<link rel="stylesheet" href="/css/app.css?v=145ccd37">`. The `v` value is the first 8 hex characters of the file's md5. The second constructor argument chooses another hash algorithm. The method behind the helper is `$asset->url($path)`; it is also callable directly.

- A file that does not exist is returned unchanged: `/css/none.css` stays `/css/none.css`.
- A path that already has a query string gets `&v=...`: `/css/app.css?x=1` becomes `/css/app.css?x=1&v=145ccd37`.
- `embed($path)` returns the file's contents, or an empty string when it is missing. `exists($path)` tells whether the file is there.
- The path is untrusted input as far as the class is concerned: a `..` segment, a null byte, or a path that resolves outside `public/` (a symbolic link, for instance) is treated as a missing file.
- Without a registered `Asset`, `asset()` returns the path as given and `embed()` returns an empty string.

## Good to know

- **No engine, no pages.** A controller that renders without a mounted engine answers 500. `withRenderEngine()` also covers controllers built by a factory or a container.
- **A render failure is a 500.** A missing template or an error inside one throws `RenderException`, and the client sees `Internal Server Error`, never the message. `render()` on a missing page: `Template [pages/nope] not found.` Report it with an event listener (see [Errors](../errors/)).
- **Page names are untrusted.** Both engines refuse a name containing `..` or a null byte, and a file that resolves outside the views directory. Still, never build a page name from a request parameter.
- **`route()` needs the router.** Calling it in a template rendered outside an application (a command-line script) throws a `LogicException` unless `App::setUrlGenerator()` was called.
- **A typo in `render:` is silent.** The section is not one of the built-in ones, so `engin: php` is ignored and Latte is used. Check the spelling against the list above.
- **Cache directory.** The `cache` directory must be writable by the web server. Keep it out of `public/`, and out of version control.
