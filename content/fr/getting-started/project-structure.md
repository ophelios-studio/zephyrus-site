---
title: Structure du projet
order: 3
description: L’organisation conventionnelle d’une application Zephyrus, ce que la découverte des contrôleurs analyse, et ce qui relève de la convention ou de l’obligation.
---

# Structure du projet

Où placer les choses, et ce qui compte vraiment.

Zephyrus ne génère pas de squelette et n’impose aucune organisation. Ce qui suit est l’organisation utilisée par le guide et les exemples. La majeure partie relève de la convention : le framework n’a besoin que des chemins que vous lui transmettez.

## L’organisation conventionnelle

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
├── vendor/
├── .env
├── composer.json
└── config.yml
```

| Chemin | Contenu |
| --- | --- |
| `app/` | Votre code, dans l’espace de noms `App\` (associé par `composer.json`). |
| `app/Controllers/` | Les classes de contrôleurs, découvertes par le routeur. |
| `app/Views/` | Les gabarits Latte (le répertoire que vous donnez à `LatteEngine`, ou `render.directory` lorsque la section `render` est enregistrée). |
| `app/Kernel.php` | Une classe de démarrage qui vous appartient : elle construit l’`Application` une seule fois pour que `public/index.php` et les tests la partagent. |
| `cache/latte/` | Les gabarits compilés (le répertoire de cache que vous donnez à `LatteEngine`). Créé au premier besoin. |
| `locale/<lang>/*.json` | Les catalogues de traduction (le réglage `localization.locale_path`). |
| `public/` | La racine documentaire. Contient `index.php` et les ressources statiques. |
| `tests/` | Les tests PHPUnit, dans l’espace de noms `Tests\` si vous l’associez sous `autoload-dev`. |
| `config.yml` | La configuration. |
| `.env` | Les valeurs d’environnement locales, chargées par votre contrôleur frontal. |

## Ce qui est obligatoire

Seules quelques choses sont fixes :

- La racine documentaire est `public/`, avec un contrôleur frontal qui construit l’application. Le serveur web ne doit jamais servir la racine du projet.
- Les contrôleurs se trouvent sous un répertoire que vous passez à `discoverControllers()`, dans un espace de noms qui correspond à leur chemin (PSR-4), afin que le routeur puisse déduire chaque nom de classe à partir de son fichier.
- `config.yml` utilise les noms de sections intégrés (`application`, `session`, `security`, `localization`, `database`). Une clé qui ressemble à un nom intégré mal orthographié (`sesion`) est refusée au démarrage. Une section qui vous est propre, comme `render` ou `mailer`, n’est lue que si vous enregistrez une classe pour elle, voir [Configuration](../../fundamentals/configuration/).

Tout le reste peut être déplacé : `config.yml` peut se trouver ailleurs puisque vous donnez son chemin à `Configuration::fromYamlFile()`, les vues peuvent résider dans n’importe quel répertoire que vous passez à `LatteEngine`, et la classe de démarrage peut porter n’importe quel nom ou être écrite directement dans `public/index.php`, comme sur la page d’[installation](../installation/).

## La classe de démarrage

`public/index.php` reste à trois lignes quand le travail est déplacé dans une classe qui vous appartient :

```php
<?php

declare(strict_types=1);

require dirname(__DIR__) . '/vendor/autoload.php';

App\Kernel::run(dirname(__DIR__));
```

Le framework n’a pas de `Kernel` de base : cette classe est du code d’application ordinaire. Garder une méthode `application()` qui retourne l’`Application` construite permet à un test de bâtir la même application sans rien envoyer. La [première application](../first-application/) présente un `Kernel` complet.

## Ce que `discoverControllers` analyse

```php
$router = (new Router())->discoverControllers('App\\Controllers', $root . '/app/Controllers');
```

Le routeur parcourt le répertoire et ses sous-répertoires, prend chaque fichier `.php`, déduit le nom de la classe à partir du préfixe d’espace de noms et du chemin relatif (`Admin/PingController.php` devient `App\Controllers\Admin\PingController`), puis enregistre les routes déclarées par attributs sur cette classe.

- Les fichiers sont chargés automatiquement : la classe doit exister et correspondre à son chemin.
- Les classes abstraites, les interfaces et les traits sont ignorés.
- Une classe sans attribut de route est inoffensive : elle n’ajoute aucune route.
- Un répertoire inexistant est ignoré : une faute de frappe dans le chemin donne donc une application sans route, et un `404` pour tout.
- Le troisième argument, facultatif, restreint la découverte aux sous-classes d’une classe parente.

Les contrôleurs sont des classes, pas des fichiers : un projet peut appeler `discoverControllers()` plusieurs fois pour plusieurs répertoires, ou enregistrer une classe à la fois avec `controller()`. Voir [Routage](../../fundamentals/routing/) et [Contrôleurs](../../fundamentals/controllers/).

## Bon à savoir

- Gardez les ressources statiques (CSS, JavaScript, images) dans `public/`, et tout le reste en dehors.
- `cache/` doit être accessible en écriture à l’utilisateur du serveur web. Gardez-le hors du contrôle de version.
- Ajoutez `.env` et `cache/` à `.gitignore`, et versionnez un `.env.example` avec les noms des variables et sans secrets.
- Les fichiers de localisation sont lus depuis `locale/<lang>/*.json` : un répertoire par langue. Voir [Localisation](../../fundamentals/localization/).
- Les gabarits compilés sont reconstruits lorsqu’un gabarit change : supprimer `cache/latte/` est donc toujours sans risque.
