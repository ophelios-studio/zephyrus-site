---
title: Introduction
order: 1
description: Ce qu'est Zephyrus, les principes qui le guident, un premier contrôleur et une première route, et où poursuivre la lecture.
---

# Introduction

Un framework qui dit ce qu'il fait.

Zephyrus est un framework PHP 8.4 pour les applications rendues côté serveur et les API JSON. Il vous offre le routage par attributs, des objets de requête et de réponse immuables, une configuration YAML stricte, des middlewares de sécurité, des vues Latte, des sessions, la validation, une couche de données PostgreSQL, le courriel et la localisation, dans un seul paquet, avec une seule façon de faire chaque chose.

C'est une bibliothèque, pas un générateur de squelette : votre application est un répertoire de vos propres classes, accompagné d'un `config.yml` et d'un contrôleur frontal. Il n'y a aucune classe d'application globale à étendre et aucune génération de code.

## Ce qu'il n'est pas

- Ce n'est pas un framework de serveur persistant. Une seule requête est traitée par processus PHP (php-fpm, `mod_php`, le serveur intégré).
- Ce n'est pas un ORM. La couche de données exécute le SQL que vous écrivez, avec des paramètres, et convertit les lignes en objets.
- Ce n'est pas de la magie. Rien n'est câblé dans votre dos : les middlewares dont vous dépendez sont montés dans votre propre code de démarrage, où vous pouvez les lire.

## Principes

### La configuration refuse les erreurs

Chaque section intégrée de `config.yml` est vérifiée au démarrage. Une clé mal orthographiée est une erreur, pas une valeur par défaut silencieuse :

```yaml
application:
  debugg: true
```

```text
Zephyrus\Core\Config\ConfigurationException: Configuration section 'application' field 'debugg' is an unknown key: did you mean "debug"?
```

### La sécurité est câblée, et vérifiée

Les réglages sous `security:` décrivent ce que votre application promet. Ils n'activent rien par eux-mêmes : vous montez le middleware correspondant, et `build()` refuse de démarrer lorsqu'un réglage déclaré n'est pas appliqué.

```yaml
security:
  csrf:
    enabled: true
```

```text
Zephyrus\Core\Config\ConfigurationException: Configuration declares security settings that this application does not enforce as declared:
  - security.csrf is not enforced as declared: mount new Zephyrus\Security\CsrfMiddleware(...) globally with withMiddleware(), built from the configuration's security through CsrfConfig::fromSecurityConfig()

Apply the fix given for each setting, or acknowledge the gap explicitly with ApplicationBuilder::withAcknowledgedSecurityKeys([...]) when the protection is provided elsewhere (a reverse proxy, a wrapping middleware, the web server).
```

Une promesse dans la configuration que rien ne tient est le genre d'erreur qui passe inaperçue en production : elle échoue donc au démarrage.

### Les routes vivent à côté de leur contrôleur

Une route est un attribut placé sur la méthode qui la traite. L'URL, la méthode HTTP et la réponse sont visibles au même endroit. Voir [Routage](../../fundamentals/routing/).

### Les requêtes et les réponses sont immuables

`Request` et `Response` sont des valeurs. `withHeader()` retourne une nouvelle réponse au lieu de modifier celle que vous détenez, de sorte qu'un middleware ne peut jamais altérer un message qu'une autre partie du code lit encore. Voir [HTTP](../../fundamentals/http/).

### Le reste de la pile

- Des [vues Latte](../../fundamentals/views/) avec échappement automatique.
- Des [sessions](../../fundamentals/sessions/), la protection CSRF et les messages éclair.
- Une [validation](../../fundamentals/validation/) qui retourne des erreurs que vous pouvez réafficher.
- Une [couche PostgreSQL](../../fundamentals/data/) construite sur du SQL explicite, des brokers et des entités.
- La [localisation](../../fundamentals/localization/) à partir de catalogues JSON.
- Le [courriel](../../digging-deeper/mail/), les [téléversements](../../digging-deeper/uploads/) et la [cryptographie](../../digging-deeper/cryptography/).

## Un premier aperçu

Un contrôleur étend `Zephyrus\Controller\Controller`. Une route est un attribut :

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

Une requête vers `/hello` obtient cette réponse :

```text
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8

{"message":"Hello, world."}
```

Tout autre chemin donne un `404`, et `POST /hello` donne un `405` accompagné d'un en-tête `allow`. La page d'[installation](../installation/) construit exactement cette application.

## Prérequis

PHP 8.4 ou plus récent avec les extensions `intl`, `mbstring`, `pdo`, `sodium` et `fileinfo`, ainsi que `pdo_pgsql` si vous utilisez PostgreSQL.

## Licence et code source

Zephyrus est publié sous la licence MIT. Le paquet est `zephyrus-framework/core` sur Packagist et le code source se trouve à [github.com/ophelios-studio/zephyrus-core](https://github.com/ophelios-studio/zephyrus-core).

## Où poursuivre la lecture

1. [Installation](../installation/) : installer le paquet et servir une première réponse.
2. [Structure du projet](../project-structure/) : où placer les fichiers et ce qui est obligatoire.
3. [Première application](../first-application/) : une petite application pilotée par un formulaire, avec un test.
4. [Configuration](../../fundamentals/configuration/) et [Application](../../fundamentals/application/) : le démarrage en détail.
