---
title: Localization
order: 13
description: Translate text from JSON catalogs, pick the locale of a request, and format money, numbers and dates for a locale.
---

# Localization

Another language. A JSON file.

Zephyrus translates from JSON catalogs, picks the locale of a request from the `Accept-Language` header, and formats numbers, money and dates with PHP's `intl` extension. Translation and formatting are two services, `Translator` and `Formatter`, that `ApplicationBuilder::build()` installs for you.

## Configuration

```yaml
localization:
  locale: en_CA
  supported_locales: [en, fr]
  locale_path: locale
  timezone: America/Toronto
  currency: CAD
```

| Key | Meaning |
|---|---|
| `locale` | The default locale (default `en`). It is lower-cased: `en_CA` is stored as `en_ca`. |
| `supported_locales` | The allowlist used when the locale is picked from a request. Always set it: an empty list accepts whatever locale the client sends. |
| `locale_path` | The directory holding the catalogs. A relative path resolves against the `basePath` given to `withConfiguration()`. |
| `timezone` | Applied with `date_default_timezone_set()` at `build()` (default `UTC`). |
| `currency` | The currency code `money` uses when none is passed, three letters. |
| `date_format`, `time_format`, `datetime_format` | The default for `date`, `time` and `datetime`: an ICU preset (`short`, `medium`, `long`, `full`) or an ICU pattern such as `yyyy-MM-dd HH:mm`. Defaults `medium`, `short`, `medium`. |
| `grouping_separator` | The thousands separator: `,`, `.`, `'`, a space, U+00A0, U+202F or U+2009. `''` turns grouping off, and it cannot be the decimal sign of the locale. |

An unknown key stops the boot, like everywhere else in the configuration. Each key accepts its snake_case or camelCase spelling.

```php
$app = ApplicationBuilder::create()
    ->withConfiguration($config, basePath: $root)
    ->build();
```

`build()` creates one `Translator` and one `Formatter` for the default locale and stores them for the helper functions below.

## Catalogs

A catalog is a directory of JSON files per language. Every `*.json` file under `locale/<language>/` is read, merged in alphabetical order, and nested objects become dot-separated keys:

```json
{
  "cart": {
    "title": "Your cart",
    "greeting": "Hello, {name|trim|title}!",
    "items": "{count} {count|plural:item:items}",
    "total": "Total: {amount|money}"
  }
}
```

Saved as `locale/en/cart.json`, with a French `locale/fr/cart.json` next to it. Then:

```php
localize('cart.items', ['count' => 3]);          // "3 items"
localize('cart.total', ['amount' => 1234.5]);    // "Total: $1,234.50"
localize('cart.items', ['count' => 0], 'fr');    // "0 article"
localize('cart.missing');                        // "cart.missing"
```

`localize()` is the global helper (`i18n()` is an alias). Its third argument forces a locale. It translates for the default locale otherwise.

The lookup order for a requested locale such as `fr-CA` is: `fr-CA`, then `fr`, then the default locale, then its base language. A key found in none of them returns the key itself, so a missing translation shows up as visible text rather than an error. A literal key containing dots (`"cart.flat": "..."`) wins over the nested path of the same name.

A language can also be one file, `locale/en.json`, when the directory is absent. A missing catalog is empty. An unreadable file or invalid JSON throws a `LocalizationException` the first time that locale is loaded.

### Parameters and pipes

A placeholder is `{name}`, or `{name|pipe|pipe:argument}`. Pipes apply left to right. A placeholder without a matching parameter stays as written.

| Pipe | Effect |
|---|---|
| `lower`, `upper`, `title` | change the case |
| `trim`, `ltrim`, `rtrim` | strip whitespace |
| `number:2:,:.` | `precision:thousands:decimal`, so `1234.567` becomes `1,234.57` |
| `truncate:10:...` | cut to a length, with an optional suffix (default `…`) |
| `plural:item:items` | the word for the number, `item:items` (the word only: write the count yourself). Without a second form, an `s` is appended |
| `default:text` | the text when the value is empty |
| `money`, `date`, `decimal`, ... | any `Formatter` name, built-in or registered |

Plural forms follow the rules of the locale, so French uses the singular for `0` and `1`. An unknown pipe throws a `LocalizationException` that lists the valid ones.

Parameters are converted to text before the pipes run: pass the raw number to a `money` pipe, not a preformatted string.

## The locale of a request

`localize()` uses the default locale. To answer a visitor in their language, resolve the locale from the request, then install a translator and a formatter for it. A middleware is the place:

```php
use Zephyrus\Core\App;
use Zephyrus\Formatting\Formatter;
use Zephyrus\Http\MiddlewareInterface;
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Localization\JsonLocaleLoader;
use Zephyrus\Localization\LocaleResolver;
use Zephyrus\Localization\Translator;

final class LocaleMiddleware implements MiddlewareInterface
{
    public function __construct(private readonly string $localePath)
    {
    }

    public function process(Request $request, callable $next): Response
    {
        $requested = $request->query('lang');

        $locale = (new LocaleResolver())->resolve(
            requestedLocale: is_string($requested) ? $requested : null,
            acceptLanguageHeader: $request->headers()->get('accept-language'),
            defaultLocale: 'en',
            supportedLocales: ['en', 'fr'],
        );

        App::setTranslator(new Translator(new JsonLocaleLoader($this->localePath), $locale));
        App::setFormatter(new Formatter($locale, 'CAD'));

        return $next($request->withAttribute('locale', $locale));
    }
}
```

Mount it with `withMiddleware()` (see [Middleware](../middleware/)). A controller then calls `localize()` and `format()` as usual:

```php
return $this->json([
    'greeting' => localize('cart.greeting', ['name' => '  ada lovelace ']),
    'total' => localize('cart.total', ['amount' => 1234.5]),
]);
// Accept-Language: fr-CA,fr;q=0.9
// {"greeting":"Bonjour, Ada Lovelace !","total":"Total : 1 234,50 $CA"}
```

(In the real output the spaces inside the amount are non-breaking.)

`LocaleResolver::resolve()` prefers the explicit value (a URL segment, a cookie, a form field), then the `Accept-Language` candidates by quality, then the default. A candidate is accepted when it, or its base language, is in `supportedLocales`: `fr-CA,fr;q=0.9` against `['en', 'fr']` gives `fr`, and `de` gives the default. The explicit value is checked against the same allowlist, so with `supportedLocales` set a visitor cannot choose a locale of their own invention. `AcceptLanguageResolver::resolve($header, $supported, $default, $requested)` is the same logic without the null handling.

Set both the translator and the formatter. A `money` or `date` pipe inside a translation uses the application's `Formatter`, not the language of the translation: with only the translator changed, a French sentence still prints `$1,234.50`.

The `Application` returned by `build()` has the same logic as two methods, for a script or a test that holds the application: `$app->transFromRequest($key, $params, $request)` translates in the locale the request asks for, and `$app->resolveLocaleFromRequest($request)` returns that locale (`null` when you pass neither a request nor a locale).

## Loaders

`JsonLocaleLoader` is the default, built from `locale_path`. The loaders share `LocaleLoaderInterface` (`load(string $locale): array`), and two decorate another loader:

```php
use Zephyrus\Localization\CachedLocaleLoader;
use Zephyrus\Localization\FallbackLocaleLoader;
use Zephyrus\Localization\JsonLocaleLoader;

$loader = new CachedLocaleLoader(
    new FallbackLocaleLoader([
        new JsonLocaleLoader($root . '/vendor-locale'),   // base translations
        new JsonLocaleLoader($root . '/locale'),          // the application wins
    ]),
    debug: false,
    prefix: 'site',
    ttl: 3600,
);

$builder = $builder->withLocaleLoader($loader, defaultLocale: 'en');
```

- `FallbackLocaleLoader` merges several loaders key by key, the last one winning. Use it to override the translations of a package. `withJsonLocaleLayers([...paths])` and `withFallbackLoaders([...loaders])` build it for you.
- `CachedLocaleLoader` keeps catalogs in APCu when the extension is available and `debug` is `false`, and reads straight from the inner loader otherwise. Call `flush()` after deploying new translation files.
- `withJsonLocales($path)`, `withLocaleLoader($loader, $default)`, `withSupportedLocales([...])` and `withLocalizationConfig($config, $basePath)` set the pieces `withConfiguration()` sets from the YAML. The last call that sets a loader wins.

Write your own by implementing the interface (a database, an API), then pass it to `withLocaleLoader()`.

## Formatting

```php
format('money', 1234.5);                   // "$1,234.50"
format('date', new DateTimeImmutable('2026-03-09'));   // "Mar 9, 2026"
```

`format($name, ...$args)` is the global helper over the application's `Formatter`. In a script that never calls `build()`, call `App::setFormatter(new Formatter('en_CA', 'CAD'))` first, or `format()` throws a `FormatterException`.

A `Formatter` is built from a locale and optional defaults, and is usable on its own:

```php
use Zephyrus\Formatting\Formatter;

$en = new Formatter('en_CA', 'CAD');
$fr = new Formatter('fr_CA', 'CAD');
```

| Method | `en_CA` | `fr_CA` |
|---|---|---|
| `money(1234.5)` | `$1,234.50` | `1 234,50 $` |
| `money(10, 'EUR')` | `€10.00` | `10,00 €` |
| `decimal(1234.567)` | `1,234.57` | `1 234,57` |
| `percent(0.256, 1)` | `25.6%` | `25,6 %` |
| `ordinal(3)` | `3rd` | `3e` |
| `spellOut(42)` | `forty-two` | `quarante-deux` |
| `date($d)` | `Mar 9, 2026` | `9 mars 2026` |
| `date($d, 'yyyy-MM-dd')` | `2026-03-09` | `2026-03-09` |
| `time($d)` | `2:05 p.m.` | `14 h 05` |
| `datetime($d)` | `Mar 9, 2026, 2:05:00 p.m.` | `9 mars 2026, 14 h 05 min 00 s` |
| `timeago($d)` | `2 hours ago` | `il y a 2 heures` |
| `duration(7830)` | `2h 10m 30s` | `2 h 10 min 30 s` |
| `filesize(1536000)` | `1.5 MB` | `1,5 Mo` |
| `list(['a', 'b', 'c'])` | `a, b, and c` | `a, b et c` |
| `truncate('Hello world', 8)` | `Hello...` | `Hello...` |

(`$d` is `2026-03-09 14:05` in the default timezone. The spaces in the French cells are non-breaking.)

- `date`, `time` and `datetime` take a `DateTimeInterface`, a Unix timestamp or a date string, and an optional preset or ICU pattern. An unparseable value throws a `FormatterException`.
- `timeago`, `duration`, `filesize` and `list` are written in French for a French locale and in English for any other language.
- `money` uses, in order, the currency you pass, the default currency, and the native currency of the locale. A locale without a country (`en`, `fr`) has none: pass a currency or set `localization.currency`, otherwise it throws.
- `list($items, 'disjunction')` joins with "or" instead of "and".

Register your own formatter, reachable as `format('initials', ...)` and as a translation pipe:

```php
$en->register('initials', fn (string $name): string => implode('', array_map(
    fn (string $part): string => strtoupper($part[0]),
    explode(' ', $name),
)));

$en->format('initials', 'ada lovelace');   // "AL"
$en->has('initials');                      // true
```

An unknown name throws a `FormatterException` that lists the built-in names. `getLocale()`, `getDefaultCurrency()` and the three `getDefault...Pattern()` methods read back the constructor values.

## In templates

`localize()` and `format()` are plain functions, so a Latte template can call them. The formatter methods become filters once registered on the engine:

```php
$views = new LatteEngine($root . '/app/Views', $root . '/cache/latte');
$views->registerFormatterFilters(App::getFormatter());
```

```latte
<h1>{localize('cart.title')}</h1>
<p>{localize('cart.items', ['count' => $count])}</p>
<p>{$price|money} {$when|date} {$ratio|percent} {$size|filesize}</p>
```

With the English formatter this renders `Your cart`, `2 items` and `$19.99 Mar 9, 2026 50% 2.0 KB`. The filters are the built-in formatter names (`money`, `decimal`, `percent`, `ordinal`, `spellOut`, `date`, `time`, `datetime`, `timeago`, `duration`, `filesize`, `list`, `truncate`) plus every formatter you registered before the call. See [Views](../views/) for the rest of the template engine.

## Good to know

- A translated sentence in the middle of a request that uses another locale needs both `App::setTranslator()` and `App::setFormatter()`. One without the other mixes languages.
- `registerFormatterFilters()` binds the formatter you pass it. A formatter installed later by a middleware does not reach the filters: register your own filter that calls `format()` (`$views->getLatteEngine()->addFilter('money', fn ($v) => format('money', $v))`), or call `localize()` and `format()` as functions in the template.
- A key missing from the requested language falls back to the default language silently. Keep the default catalog complete, and compare the key lists of the others in a test.
- Always pass `supportedLocales` to the resolver: with an empty list it returns the explicit value as given. `JsonLocaleLoader` refuses anything that is not a language tag (the catalog is then empty), but the allowlist is what keeps the choice yours.
- `plural` prints the word, not the count: write `{count} {count|plural:item:items}`.
- `localization.locale` is stored lower-cased and `supported_locales` too: `fr-CA` becomes `fr-ca`, and catalog directories named `fr-CA` or `fr_CA` still match.
