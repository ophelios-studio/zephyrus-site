---
title: Installation
order: 2
description: Installer Zephyrus avec Composer, démarrer la plus petite application, la servir en local et derrière un serveur web, et charger les variables d’environnement.
---

# Installation

D’un répertoire vide à une première réponse.

## Prérequis

- PHP 8.4 ou plus récent.
- Les extensions `intl`, `mbstring`, `pdo`, `sodium` et `fileinfo`.
- `pdo_pgsql` si l’application utilise PostgreSQL.
- [Composer](https://getcomposer.org/).

Composer installe pour vous les autres dépendances : Latte, Tracy, Symfony YAML, `vlucas/phpdotenv` et PHPMailer.

## Installer le paquet

Créez un `composer.json` :

```json
{
    "require": {
        "php": "^8.4",
        "zephyrus-framework/core": "^3.17"
    },
    "autoload": { "psr-4": { "App\\": "app/" } }
}
```

puis exécutez :

```bash
composer install
```

`^3.17` installe la dernière version 3.x. Depuis la 3.17.0, l’API est stable et suit le versionnage sémantique : les versions mineures et correctives restent compatibles, et un changement incompatible attend la 4.0, annoncé d’abord par une dépréciation. Le [journal des modifications](https://github.com/ophelios-studio/zephyrus-core/blob/dev/CHANGELOG.md) détaille ce que change chaque version. L’espace de noms `App\` vous appartient : il correspond au répertoire `app/`.

Vous partez de `^0.16` ? Composer ne passe pas seul de `^0.16` à `^3.17`. Changez la contrainte à la main dans `composer.json`, puis lisez le [journal des modifications](https://github.com/ophelios-studio/zephyrus-core/blob/dev/CHANGELOG.md) : les changements incompatibles de la 3.17.0 y figurent en tête, chacun avec la modification à faire.

## La plus petite application

Trois fichiers suffisent pour démarrer une application.

`config.yml` :

```yaml
application:
  environment: !env APP_ENV, production
  debug: !env APP_DEBUG, false
```

`app/Controllers/HelloController.php` :

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

`public/index.php`, le contrôleur frontal :

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

`Configuration::fromYamlFile()` lit et valide le fichier, le routeur découvre chaque contrôleur sous `app/Controllers`, et `ApplicationBuilder` assemble une `Application`. `handle()` transforme la requête en réponse et `send()` l’écrit.

Cette application n’a ni sessions, ni protection CSRF, ni vues, ce qui explique qu’elle puisse démarrer avec si peu. La [première application](../first-application/) les ajoute, et [Application](../../fundamentals/application/) décrit le builder en détail.

## L’exécuter

Le serveur intégré de PHP suffit pour le développement. La configuration est `production` par défaut : définissez donc `APP_ENV=dev` sur votre machine :

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

La sortie est abrégée : la vraie réponse contient d’autres en-têtes (`Host`, `Date`, `X-Powered-By`, etc.).

Un chemin inconnu donne `404 Not Found`, et `POST /hello` donne `405 Method Not Allowed` avec `allow: GET, HEAD`.

Le serveur intégré est réservé au développement.

## Derrière un serveur web

Faites pointer la racine documentaire vers `public/`, jamais vers la racine du projet, afin que `config.yml`, `vendor/` et `app/` ne puissent pas être demandés. Envoyez à `public/index.php` toute requête qui ne correspond pas à un fichier existant.

nginx avec php-fpm :

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

Apache a besoin de `mod_rewrite` (`a2enmod rewrite` sur Debian et Ubuntu) et, puisque les règles ci-dessous se trouvent dans `.htaccess`, de `AllowOverride All` sur le répertoire `public/` de l’hôte virtuel. Placez-les dans `public/.htaccess` :

```apache
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^ index.php [L]
```

### Réglages PHP pour la production

`ApplicationBuilder::build()` désactive `display_errors` et `display_startup_errors`, sauf si le débogage est actif pour ce démarrage et que le client est de ceux que le débogueur admet (ou que le processus s’exécute en ligne de commande). Une erreur levée avant l’appel à `build()`, comme celle de la lecture de la configuration, s’affiche encore quand le réglage de PHP est activé, et la valeur par défaut intégrée de PHP est `display_errors=1` lorsqu’aucun `php.ini` n’est chargé (certaines images de conteneur officielles n’en fournissent aucun). Si ce réglage reste actif, une telle erreur est affichée au client avec le chemin du fichier et la trace. Définissez ces valeurs dans le `php.ini` que php-fpm ou Apache charge (PHP fournit un `php.ini-production` qui les contient déjà) :

```ini
display_errors = Off
display_startup_errors = Off
log_errors = On
```

Vérifiez la valeur réellement utilisée par le serveur avec `php -i | grep display_errors` (pour la CLI, qui peut charger un autre `php.ini` que php-fpm), ou avec `ini_get('display_errors')` depuis l’application.

Terminez le HTTPS en amont de l’application. Si un mandataire inverse précède PHP, consultez [Sécurité](../../fundamentals/security/) pour les réglages de mandataire de confiance, et montez-y aussi `ForceHttpsMiddleware` et `AllowedHostsMiddleware`.

## Variables d’environnement

`!env NAME, default` dans `config.yml` lit la variable depuis `$_ENV` ou l’environnement du processus au moment de l’analyse. Une variable non définie et sans valeur par défaut est lue comme `null` : donnez donc une valeur par défaut aux réglages booléens et énumérés.

Zephyrus ne lit jamais de fichier `.env` lui-même. Le paquet apporte `vlucas/phpdotenv` : chargez le fichier dans le contrôleur frontal, avant la configuration :

```php
Dotenv\Dotenv::createImmutable($root)->safeLoad();
$config = Configuration::fromYamlFile($root . '/config.yml');
```

Avec un fichier `.env` contenant `APP_ENV=dev`, `$config->application->environment` vaut `Environment::Development`. Sans lui, la valeur par défaut `production` s’applique : un serveur où `APP_ENV` n’est pas défini fonctionne donc en production. Une personne qui développe définit `APP_ENV=dev` localement.

Bon à savoir :

- Gardez les secrets (mot de passe de base de données, clé de chiffrement) dans l’environnement et référencez-les avec `!env`. Ne les écrivez jamais en clair dans `config.yml`.
- Gardez `.env` hors du contrôle de version, et hors de la racine documentaire.
- La sortie de débogage est désactivée en production et en préproduction, quelle que soit la valeur de `APP_DEBUG`.
- `!env` ne lit pas `$_SERVER` et refuse les noms qui commencent par `HTTP_`, car un client peut les définir à chaque requête.

Poursuivez avec [Structure du projet](../project-structure/), ou passez directement à la [première application](../first-application/). La configuration est traitée dans [Configuration](../../fundamentals/configuration/).
