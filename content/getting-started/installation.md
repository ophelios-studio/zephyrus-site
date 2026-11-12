---
title: Installation
order: 2
description: Require Zephyrus with Composer, boot the smallest application, serve it locally and behind a web server, and load environment variables.
---

# Installation

From an empty directory to a first response.

## Requirements

- PHP 8.4 or later.
- The `intl`, `mbstring`, `pdo`, `sodium` and `fileinfo` extensions.
- `pdo_pgsql` if the application uses PostgreSQL.
- [Composer](https://getcomposer.org/).

Composer installs the other dependencies for you: Latte, Tracy, Symfony YAML, `vlucas/phpdotenv` and PHPMailer.

## Require the package

Create a `composer.json`:

```json
{
    "require": {
        "php": "^8.4",
        "zephyrus-framework/core": "^0.14"
    },
    "autoload": { "psr-4": { "App\\": "app/" } }
}
```

then run:

```bash
composer install
```

`^0.14` installs the latest 0.14 release. Before 1.0 a minor version may break the API, so Composer never moves you to 0.15 on its own: read the [changelog](https://github.com/ophelios-studio/zephyrus-core/blob/dev/CHANGELOG.md) before you change the constraint. The `App\` namespace is yours: it maps to the `app/` directory.

## The smallest application

Three files boot an application.

`config.yml`:

```yaml
application:
  environment: !env APP_ENV, production
  debug: !env APP_DEBUG, false
```

`app/Controllers/HelloController.php`:

```php
<?php

declare(strict_types=1);

namespace App\Controllers;

use Zephyrus\Controller\Controller;
use Zephyrus\Http\Response;
use Zephyrus\Routing\Attribute\Get;

final class HelloController extends Controller
{
    #[Get('/hello')]
    public function hello(): Response
    {
        return $this->json(['message' => 'Hello, world.']);
    }
}
```

`public/index.php`, the front controller:

```php
<?php

declare(strict_types=1);

use Zephyrus\Core\ApplicationBuilder;
use Zephyrus\Core\Config\Configuration;
use Zephyrus\Http\Request;
use Zephyrus\Routing\Router;

$root = dirname(__DIR__);
require $root . '/vendor/autoload.php';

$config = Configuration::fromYamlFile($root . '/config.yml');
$router = (new Router())->discoverControllers('App\\Controllers', $root . '/app/Controllers');

ApplicationBuilder::create()
    ->withConfiguration($config, basePath: $root)
    ->withRouter($router)
    ->build()
    ->handle(Request::fromGlobals())
    ->send();
```

`Configuration::fromYamlFile()` reads and validates the file, the router discovers every controller under `app/Controllers`, and `ApplicationBuilder` assembles an `Application`. `handle()` turns the request into a response and `send()` writes it.

This application has no sessions, no CSRF protection and no views, which is why it can boot with so little. The [first application](../first-application/) adds them, and [Application](../../fundamentals/application/) describes the builder in full.

## Run it

PHP's built-in server is enough for development. The configuration defaults to `production`, so set `APP_ENV=dev` on your machine:

```bash
APP_ENV=dev php -S 127.0.0.1:8000 -t public
```

```bash
curl -i http://127.0.0.1:8000/hello
```

```text
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8

{"message":"Hello, world."}
```

The output is abridged: the real response carries more headers (`Host`, `Date`, `X-Powered-By` and so on).

An unknown path answers `404 Not Found`, and `POST /hello` answers `405 Method Not Allowed` with `allow: GET, HEAD`.

The built-in server is for development only.

## Behind a web server

Point the document root at `public/`, never at the project root, so that `config.yml`, `vendor/` and `app/` cannot be requested. Send every request that is not an existing file to `public/index.php`.

nginx with php-fpm:

```nginx
server {
    server_name app.example.test;
    root /var/www/app/public;

    location / {
        try_files $uri /index.php$is_args$args;
    }

    location = /index.php {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root/index.php;
        fastcgi_pass unix:/run/php/php8.4-fpm.sock;
    }
}
```

Apache needs `mod_rewrite` (`a2enmod rewrite` on Debian and Ubuntu) and, because the rules below live in `.htaccess`, `AllowOverride All` on the `public/` directory of the virtual host. Put them in `public/.htaccess`:

```apache
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^ index.php [L]
```

### PHP settings for production

Zephyrus does not change PHP's own error display, and PHP's built-in default is `display_errors=1` when no `php.ini` is loaded (some official container images ship none). Left on, an uncaught exception or a warning is printed to the client with its file path and trace. Set these in the `php.ini` that php-fpm or Apache loads (PHP ships a `php.ini-production` that already has them):

```ini
display_errors = Off
display_startup_errors = Off
log_errors = On
```

Check the value the server really uses with `php -i | grep display_errors` (for the CLI, which may load another `php.ini` than php-fpm), or with `ini_get('display_errors')` from the application.

Terminate HTTPS in front of the application. If a reverse proxy sits in front of PHP, see [Security](../../fundamentals/security/) for the trusted proxy settings, and mount `ForceHttpsMiddleware` and `AllowedHostsMiddleware` there too.

## Environment variables

`!env NAME, default` in `config.yml` reads the variable from `$_ENV` or the process environment at parse time. An unset variable without a default reads as `null`, so give boolean and enumerated settings a default.

Zephyrus never reads a `.env` file itself. The package brings `vlucas/phpdotenv`, so load the file in the front controller before the configuration:

```php
Dotenv\Dotenv::createImmutable($root)->safeLoad();
$config = Configuration::fromYamlFile($root . '/config.yml');
```

With a `.env` file containing `APP_ENV=dev`, `$config->application->environment` is `Environment::Development`. Without it, the default `production` applies, so a server where `APP_ENV` is unset runs in production. A developer sets `APP_ENV=dev` locally.

Good to know:

- Keep secrets (database password, encryption key) in the environment and reference them with `!env`. Never write one inline in `config.yml`.
- Keep `.env` out of version control, and out of the document root.
- Debug output is forced off in production and staging, whatever `APP_DEBUG` says.
- `!env` does not read `$_SERVER`, and refuses names that start with `HTTP_`, because a client can set those per request.

Read on with [Project structure](../project-structure/), or go straight to the [first application](../first-application/). Configuration is covered in [Configuration](../../fundamentals/configuration/).
