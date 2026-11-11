---
title: Introduction
order: 1
description: What Zephyrus is, the principles behind it, a first controller and route, and where to read next.
---

# Introduction

A framework that says what it does.

Zephyrus is a PHP 8.4 framework for server-rendered applications and JSON APIs. It gives you attribute routing, immutable request and response objects, a strict YAML configuration, security middleware, Latte views, sessions, validation, a PostgreSQL data layer, mail and localization, in one package with one way to do each thing.

It is a library, not a skeleton generator: your application is a directory of your own classes plus a `config.yml` and a front controller. There is no global application class to extend and no code generation.

## What it is not

- It is not a long-running server framework. One request is handled per PHP process (php-fpm, `mod_php`, the built-in server).
- It is not an ORM. The data layer runs the SQL you write, with parameters, and maps rows to objects.
- It is not magic. Nothing is wired for you behind your back: the middleware you rely on is mounted in your own bootstrap code, where you can read it.

## Principles

### Configuration refuses mistakes

Every built-in section of `config.yml` is checked at boot. A misspelled key is an error, not a silent default:

```yaml
application:
  debugg: true
```

```text
Zephyrus\Core\Config\ConfigurationException: Configuration section 'application' field 'debugg' is an unknown key: did you mean "debug"?
```

### Security is wired, and checked

Settings under `security:` describe what your application promises. They do not turn anything on by themselves: you mount the matching middleware, and `build()` refuses to boot when a declared setting is not enforced.

```yaml
security:
  csrf:
    enabled: true
```

```text
Zephyrus\Core\Config\ConfigurationException: Configuration declares security settings that this application does not enforce as declared:
  - security.csrf is not enforced as declared: mount new Zephyrus\Security\CsrfMiddleware(...) globally with withMiddleware(), built from the configuration's security through CsrfConfig::fromSecurityConfig()
```

A promise in the configuration that nothing keeps is the kind of mistake that ships unnoticed, so it fails at boot instead.

### Routes live next to their controller

A route is an attribute on the method that handles it. The URL, the HTTP method and the response are visible in one place. See [Routing](../../fundamentals/routing/).

### Requests and responses are immutable

`Request` and `Response` are values. `withHeader()` returns a new response instead of changing the one you hold, so a middleware can never alter a message another part of the code is still reading. See [HTTP](../../fundamentals/http/).

### The rest of the stack

- [Latte views](../../fundamentals/views/) with automatic escaping.
- [Sessions](../../fundamentals/sessions/), CSRF protection and flash messages.
- [Validation](../../fundamentals/validation/) that returns errors you can show back.
- A [PostgreSQL layer](../../fundamentals/data/) built on explicit SQL, brokers and entities.
- [Localization](../../fundamentals/localization/) from JSON catalogs.
- [Mail](../../digging-deeper/mail/), [uploads](../../digging-deeper/uploads/) and [cryptography](../../digging-deeper/cryptography/).

## A first taste

A controller extends `Zephyrus\Controller\Controller`. A route is an attribute:

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

Requesting `/hello` answers:

```text
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8

{"message":"Hello, world."}
```

Any other path is a `404`, and `POST /hello` is a `405` with an `allow` header. The [installation](../installation/) page builds exactly this application.

## Requirements

PHP 8.4 or later with the `intl`, `mbstring`, `pdo`, `sodium` and `fileinfo` extensions, and `pdo_pgsql` if you use PostgreSQL.

## License and source

Zephyrus is released under the MIT license. The package is `zephyrus-framework/core` on Packagist and the source is at [github.com/ophelios-studio/zephyrus-core](https://github.com/ophelios-studio/zephyrus-core).

## Where to read next

1. [Installation](../installation/): require the package and serve a first response.
2. [Project structure](../project-structure/): where files go and what is required.
3. [First application](../first-application/): a small form-driven application, with a test.
4. [Configuration](../../fundamentals/configuration/) and [Application](../../fundamentals/application/): the bootstrap in detail.
