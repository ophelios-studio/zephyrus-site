---
title: Configuration
order: 1
description: How Zephyrus reads config.yml into typed sections, resolves environment variables, refuses unknown keys at boot, and lets you add sections of your own.
---

# Configuration

Your environment, in one place.

A Zephyrus application is configured by one YAML file, usually `config.yml` at the project root. `Configuration::fromYamlFile()` reads it, resolves `!env` tags, and returns an immutable tree of typed section objects. The configuration is strict: a key the framework does not know stops the boot, so a typo never turns into a silently ignored setting.

## Load a file

```php
use Zephyrus\Core\Config\Configuration;

$config = Configuration::fromYamlFile(__DIR__ . '/config.yml');

$config->application->environment; // Environment::Production
$config->session->name;            // 'APP_SESSION'
$config->security->maxBodySize;    // 2097152
$config->database?->host;          // 'localhost', or null when there is no database section
```

Five sections are built in. All of them are always present with safe defaults, except `database`, which is `null` when the file has no `database:` key.

```yaml
application:
  environment: !env APP_ENV, production
  debug: !env APP_DEBUG, false

session:
  name: APP_SESSION
  lifetime: 0                      # seconds; 0 ends with the browser
  idle_timeout: 1800
  http_only: true
  secure: auto                     # true, false or auto (secure when the request is https)
  same_site: Lax                   # Strict, Lax or None (None requires secure)

security:
  force_https: false
  allowed_hosts: [example.com]     # host names only: no port, no scheme; an empty list accepts every Host header
  max_body_size: 2097152           # bytes, no unit suffix
  trusted_proxies: []              # addresses or CIDR network addresses
  csrf:
    enabled: true
    exceptions: ['#^/webhooks/#']  # quoted, anchored
  encryption:
    key: !env APP_ENCRYPTION_KEY
  headers:
    x_frame_options: DENY
    hsts_max_age: 31536000

localization:
  locale: en
  supported_locales: [en, fr]
  locale_path: locale              # relative to the base path given to the builder
  timezone: America/Toronto
  currency: CAD

database:
  host: !env DB_HOST, localhost
  port: !env DB_PORT, 5432
  database: !env DB_NAME, app
  username: !env DB_USERNAME, app
  password: !env DB_PASSWORD
```

Keys are accepted in `snake_case` or `camelCase` (`max_body_size` or `maxBodySize`), one spelling per key. Besides the keys above, `session` accepts `cookie_path`, `security` accepts `trusted_headers`, `localization` accepts `date_format`, `time_format`, `datetime_format` and `grouping_separator`, and `database` accepts `driver`, `charset`, `ssl_mode`, `ssl_root_cert` and `column_cache_version`.

Nothing is applied just because it is declared. The builder wires localization, applies `application.debug` and `localization.timezone`, and refuses to boot when a `security:` key is not enforced by a middleware you mounted: see [The application](../application/) and [Security](../security/).

## Environment variables

`!env NAME` reads a variable. `!env NAME, default` falls back to the text after the comma when the variable is not set.

```yaml
database:
  host: !env DB_HOST, localhost
  password: !env DB_PASSWORD
```

An unset variable without a default reads as `null`, which a required value then refuses. Every `!env` value is a string; section objects cast it (`port: !env DB_PORT, 5432` becomes the integer `5432`). Keep secrets such as passwords and encryption keys in the environment, never in the YAML file you commit.

The framework never reads a `.env` file. Load it yourself, before the configuration:

```php
Dotenv\Dotenv::createImmutable(__DIR__)->safeLoad();

$config = Configuration::fromYamlFile(__DIR__ . '/config.yml');
```

Only `$_ENV` and the process environment are read, never `$_SERVER`. `$_SERVER` carries values a client can influence, so a variable set per request with Apache `SetEnv` or a `fastcgi_param` is not seen. Set it in the real process environment: the container environment, or `env[NAME]` in a php-fpm pool.

For the same reason, a variable name that a request or the web server can supply is refused, whatever its case. Calling `env('HTTP_HOST')` directly throws an `InvalidArgumentException`; the same name in a YAML file (`debug: !env HTTP_HOST`) throws a `ConfigurationException` whose message is prefixed with the tag and the key. The refused names are those starting with `HTTP_`, `REDIRECT_`, `ORIG_`, `SSL_` or `H2_`, CGI and server names such as `REMOTE_ADDR`, `QUERY_STRING`, `HTTPS` or `SERVER_NAME`, and any name holding `=` or a NUL byte.

```text
!env tag at "application.debug": "HTTP_HOST": names starting with HTTP_ can be set per request by the client request headers, so they are never read as configuration; rename the variable.
```

`env('HTTP_HOST')` raises the same message without the `!env tag at "application.debug": ` prefix.

### The env() helper

`env()` is the same read for your own code. It returns the default when the variable is unset, and casts the strings `true`, `false`, `null` and `empty` (optionally in parentheses) to their native values.

```php
$debug = env('APP_DEBUG', false);
$from = env('MAIL_FROM', 'no-reply@example.com');
```

## Environments

`application.environment` accepts `production` (or `prod`), `staging` (or `stage`), `testing` (or `test`) and `development` (or `dev`, `local`), case-insensitively. Anything else, and an absent key, means production: the default is the strict one. The value is an `Environment` enum, and `isProductionLike()` is true for production and staging.

```php
use Zephyrus\Core\Config\Environment;

Environment::fromString('local');               // Environment::Development
Environment::fromString('banana');              // Environment::Production
Environment::Staging->isProductionLike();       // true
```

`application.debug` defaults to `true` in development and testing, and to `false` in production and staging. In a production-like environment the application forces debug off whatever the file says: see [Errors](../errors/).

## Strict validation

A key a built-in section does not know stops the boot with a `ConfigurationException` that names the closest accepted key, or lists the accepted ones:

```text
Configuration section 'security' field 'max_bdy_size' is an unknown key: did you mean "max_body_size"?
Configuration section 'session' field 'max_body_size' is an unknown key: the accepted keys are name, lifetime, httpOnly, secure, sameSite, cookiePath, idleTimeout.
Configuration section 'security' sets both 'maxBodySize' and 'max_body_size': keep one.
```

A top-level key that is close to a built-in section name is refused as well:

```text
Configuration key 'sesion' is not a known section: did you mean "session"? A section of your own needs a factory registered under its name in the $sectionFactories argument of the Configuration factories.
```

Values are checked too. Booleans accept only `true`/`false`, `1`/`0`, `on`/`off` and `yes`/`no`, and sizes are numbers of bytes:

```text
Configuration section 'application' field 'debug' has invalid value "maybe": is not a boolean; use true/false, 1/0, on/off or yes/no.
Configuration section 'security' field 'max_body_size' has invalid value "2M": must be a number of bytes, for example 2097152 (no unit suffix).
```

Read these as instructions: the message names the section, the key and what to change.

## Your own sections

Any other top-level key is ignored unless you register a section for it. A section is a subclass of `ConfigSection` whose `fromArray()` reads typed values:

```php
namespace App\Config;

use Zephyrus\Core\Config\ConfigSection;

final class BillingConfig extends ConfigSection
{
    public readonly string $provider;
    public readonly int $trialDays;

    public static function fromArray(array $values): static
    {
        $section = new static($values);
        $section->provider = $section->getString('provider', 'none');
        $section->trialDays = $section->getInt('trialDays', 30); // trial_days in YAML
        return $section;
    }
}
```

```yaml
billing:
  provider: stripe
  trial_days: 14
```

Pass the class under the section name as the second argument, and read the section back with `section()`:

```php
$config = Configuration::fromYamlFile(
    __DIR__ . '/config.yml',
    ['billing' => BillingConfig::class],
);

$config->section('billing')->trialDays; // 14
$config->hasSection('billing');         // true
```

`ConfigSection` offers `get()`, `getString()`, `getInt()`, `getFloat()`, `getBool()`, `getArray()` and `has()`. Nested keys use dots (`smtp.host`), and both `trialDays` and `trial_days` find the same value. Secrets you declare in a `$secretKeys` property are masked by `toArray()`.

The framework's own `MailerConfig` is a section of this kind. Register it as `['mailer' => MailerConfig::class]` to configure SMTP from YAML: see [Mail](../../digging-deeper/mail/).

### Good to know

- A custom section does not refuse unknown keys: a misspelled key there silently takes its default.
- A factory registered under a built-in name (`database`, in any spelling), under a blank name, or two factories naming the same section throw `InvalidArgumentException`.
- `section('database')` also throws: read built-in sections through their typed property, `$config->database`.

## Several files

When settings differ per machine, merge files. Later files override earlier ones, key by key:

```php
$config = Configuration::fromOptionalYamlFiles([
    __DIR__ . '/config.yml',
    __DIR__ . '/config.local.yml', // skipped when it does not exist
]);
```

| Method | Reads | Missing file |
| --- | --- | --- |
| `fromYamlFile($path)` | one YAML file | throws |
| `fromYamlFiles($paths)` | several YAML files, merged | throws |
| `fromOptionalYamlFiles($paths)` | several YAML files, merged | skipped |
| `fromFile($path)` | one YAML file, or a PHP file returning an array | throws |
| `fromFiles($paths)` | several YAML or PHP files, merged | throws |
| `fromOptionalFiles($paths)` | several YAML or PHP files, merged | skipped |
| `fromArray($array)` | a nested array | |
| `defaults()` | nothing: every section uses its defaults | |

All of them take the custom section map as their last argument. A missing file, a file that does not parse and a refused `!env` tag raise a `ConfigurationException`.

## Reading values anywhere

Pass the `Configuration` to the builder and it becomes available through `App::getConfiguration()` and the `config()` helper:

```php
config('security', 'maxBodySize');  // 2097152
config('billing', 'trialDays', 30); // a custom section, with a default
config('database');                 // the typed DatabaseConfig, or null
```

`config()` returns the default you pass when no configuration was set or the property is missing. It throws for a built-in section spelled any way but the exact name (`config('Database')`).

`$config->toArray()` exports the tree for inspection. Secrets (the database password, the encryption key, the mailer password) are replaced by `[redacted]` unless you pass `true`, which belongs nowhere near a debug panel or a log.

## Bootstrap variables

For deployments that choose their configuration from the environment, `ApplicationBootstrap::fromEnvironment()` builds an `Application` from a directory of PHP configuration files:

| Variable | Meaning | Default |
| --- | --- | --- |
| `APP_CONFIG_DIR` | directory holding the files | `./config` |
| `APP_CONFIG_BASE` | base file name | `app` |
| `APP_ENV` | environment suffix | none |
| `APP_CONFIG_EXTRA` | comma-separated extra suffixes | none |

It requires `<dir>/<base>.php`, then merges `<base>.local.php`, `<base>.<APP_ENV>.php` and each `<base>.<extra>.php` when they exist. With `APP_ENV=stage`, `config/app.php` is read, then `config/app.stage.php` overrides it. These files return arrays and follow the same strict rules. An environment or base name holding a path separator is refused.

```php
use Zephyrus\Core\Bootstrap\ApplicationBootstrap;

$app = ApplicationBootstrap::fromEnvironment();
$response = $app->handle($request);
```

The same class offers `fromConfigDirectory()`, `fromConfigurationFile()`, `fromConfigurationArray()` and `fromConfigFiles()` when you pass the paths yourself. An application with its own bootstrap class, as in [The application](../application/), does not need any of them.

### Good to know

- Booleans written in `!env` need a default: `debug: !env APP_DEBUG, false`. An unset variable without one reads as `null`, and a boolean setting refuses `null`.
- `allowed_hosts: []` accepts every host. An empty string or `null` is refused.
- `security.csrf`, `security.encryption` and `security.headers` must be mappings (`csrf: { enabled: false }`).
- `security.max_body_size` is bytes, an integer or a string of digits. `2M` and `1.5` are refused.
- `build()` also sets the timezone from `localization.timezone`, which defaults to `UTC`.
