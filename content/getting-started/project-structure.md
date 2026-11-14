---
title: Project structure
order: 3
description: The conventional layout of a Zephyrus application, what controller discovery scans, and which parts are convention and which are required.
---

# Project structure

Where things go, and what really matters.

Zephyrus does not generate a skeleton and does not require a layout. What follows is the layout the guide and the examples use. Most of it is convention: the framework only needs the paths you hand to it.

## The conventional layout

```text
app.example.test/
├── app/
│   ├── Controllers/
│   │   └── NoteController.php
│   ├── Views/
│   │   ├── layout.latte
│   │   └── notes.latte
│   └── Kernel.php
├── cache/
│   └── latte/
├── locale/
│   └── en/
│       └── messages.json
├── public/
│   └── index.php
├── tests/
│   └── NotesTest.php
├── var/
│   └── zephyrus/
├── vendor/
├── .env
├── composer.json
└── config.yml
```

| Path | What it holds |
| --- | --- |
| `app/` | Your code, in the `App\` namespace (mapped by `composer.json`). |
| `app/Controllers/` | Controller classes, discovered by the router. |
| `app/Views/` | Latte templates (the directory you give to `LatteEngine`, or `render.directory` when the `render` section is registered). |
| `app/Kernel.php` | A bootstrap class of your own: builds the `Application` once so that `public/index.php` and the tests share it. |
| `cache/latte/` | Compiled templates (the cache directory you give to `LatteEngine`). Created when first needed. |
| `locale/<lang>/*.json` | Translation catalogs (the `localization.locale_path` setting). |
| `public/` | The document root. Holds `index.php` and static assets. |
| `var/zephyrus/` | The caches `vendor/bin/zephyrus cache:warm` writes at deploy time (see [Configuration](../../fundamentals/configuration/#caches-and-deployment)). Absent in development, and kept out of version control. |
| `tests/` | PHPUnit tests, in the `Tests\` namespace if you map it under `autoload-dev`. |
| `config.yml` | The configuration. |
| `.env` | Local environment values, loaded by your front controller. |

## What is required

Only a few things are fixed:

- The document root is `public/`, with a front controller that builds the application. The web server must never serve the project root.
- Controllers live under a directory you pass to `discoverControllers()`, or declare under `router.controllers` in `config.yml`, in a namespace that matches their path (PSR-4), so that the router can derive each class name from its file.
- `config.yml` uses the built-in section names (`application`, `session`, `security`, `localization`, `database`, `router`). A key that looks like a misspelled built-in name (`sesion`) is refused at boot. A section of your own, such as `render` or `mailer`, is only read if you register a class for it, see [Configuration](../../fundamentals/configuration/).

Everything else is yours to move: `config.yml` can live elsewhere because you give its path to `Configuration::fromYamlFile()`, views can live in any directory you pass to `LatteEngine`, and the bootstrap class can have any name or be inlined in `public/index.php`, as on the [installation](../installation/) page.

## The bootstrap class

`public/index.php` stays three lines when the work moves into a class of your own:

```php
<?php

declare(strict_types=1);

require dirname(__DIR__) . '/vendor/autoload.php';

App\Kernel::run(dirname(__DIR__));
```

The framework has no base `Kernel`: this class is plain application code. Keeping an `application()` method that returns the built `Application` lets a test build the same application without sending anything. The [first application](../first-application/) shows a complete `Kernel`.

## What `discoverControllers` scans

```php
$router = (new Router())->discoverControllers('App\\Controllers', $root . '/app/Controllers');
```

The router walks the directory and its subdirectories, takes every `.php` file, derives the class name from the namespace prefix and the relative path (`Admin/PingController.php` becomes `App\Controllers\Admin\PingController`), and registers the routes declared by attributes on that class.

- Files are autoloaded: the class must exist and match its path.
- Abstract classes, interfaces and traits are skipped.
- A class without route attributes is harmless: it contributes no route.
- A directory that does not exist is ignored, so a typo in the path gives an application with no routes, and a `404` for everything.
- The optional third argument restricts discovery to subclasses of a parent class.

Controllers are classes, not files: a project can call `discoverControllers()` several times for several directories, or register one class at a time with `controller()`. See [Routing](../../fundamentals/routing/) and [Controllers](../../fundamentals/controllers/).

## Good to know

- Keep static assets (CSS, JavaScript, images) inside `public/`, and everything else outside it.
- `cache/` must be writable by the web server user. Keep it out of version control.
- Add `.env` and `cache/` to `.gitignore` (the warm writes its own `.gitignore` in `var/zephyrus/`), and commit a `.env.example` with the variable names and no secrets.
- Locale files are read from `locale/<lang>/*.json`: one directory per language. See [Localization](../../fundamentals/localization/).
- Compiled templates are rebuilt when a template changes, so deleting `cache/latte/` is always safe.
