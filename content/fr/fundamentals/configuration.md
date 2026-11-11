---
title: Configuration
order: 1
description: Comment Zephyrus lit config.yml dans des sections typées, résout les variables d'environnement, refuse les clés inconnues au démarrage et vous laisse ajouter vos propres sections.
---

# Configuration

Votre environnement, en un seul endroit.

Une application Zephyrus est configurée par un seul fichier YAML, habituellement `config.yml` à la racine du projet. `Configuration::fromYamlFile()` le lit, résout les balises `!env` et retourne un arbre immuable d'objets de section typés. La configuration est stricte : une clé que le framework ne connaît pas interrompt le démarrage, de sorte qu'une faute de frappe ne devient jamais un réglage ignoré en silence.

## Charger un fichier

```php
use Zephyrus\Core\Config\Configuration;

$config = Configuration::fromYamlFile(__DIR__ . '/config.yml');

$config->application->environment; // Environment::Development
$config->session->name;            // 'APP_SESSION'
$config->security->maxBodySize;    // 2097152
$config->database?->host;          // 'localhost', or null when there is no database section
```

Cinq sections sont intégrées. Toutes sont toujours présentes avec des valeurs par défaut sûres, sauf `database`, qui vaut `null` lorsque le fichier n'a pas de clé `database:`.

```yaml
application:
  environment: !env APP_ENV, dev
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

Les clés sont acceptées en `snake_case` ou en `camelCase` (`max_body_size` ou `maxBodySize`), une seule graphie par clé. Outre les clés ci-dessus, `session` accepte `cookie_path`, `security` accepte `trusted_headers`, `localization` accepte `date_format`, `time_format`, `datetime_format` et `grouping_separator`, et `database` accepte `driver`, `charset`, `ssl_mode`, `ssl_root_cert` et `column_cache_version`.

Rien n'est appliqué du seul fait d'être déclaré. Le builder câble la localisation, applique `application.debug` et `localization.timezone`, et refuse de démarrer lorsqu'une clé de `security:` n'est pas appliquée par un middleware que vous avez monté : voir [L'application](../application/) et [Sécurité](../security/).

## Variables d'environnement

`!env NAME` lit une variable. `!env NAME, default` se rabat sur le texte placé après la virgule lorsque la variable n'est pas définie.

```yaml
database:
  host: !env DB_HOST, localhost
  password: !env DB_PASSWORD
```

Une variable non définie et sans valeur par défaut est lue comme `null`, qu'une valeur obligatoire refuse alors. Toute valeur `!env` est une chaîne : les objets de section la convertissent (`port: !env DB_PORT, 5432` devient l'entier `5432`). Gardez les secrets, comme les mots de passe et les clés de chiffrement, dans l'environnement, jamais dans le fichier YAML que vous versionnez.

Le framework ne lit jamais de fichier `.env`. Chargez-le vous-même, avant la configuration :

```php
Dotenv\Dotenv::createImmutable(__DIR__)->safeLoad();

$config = Configuration::fromYamlFile(__DIR__ . '/config.yml');
```

Seuls `$_ENV` et l'environnement du processus sont lus, jamais `$_SERVER`. `$_SERVER` porte des valeurs qu'un client peut influencer : une variable définie par requête avec `SetEnv` d'Apache ou un `fastcgi_param` n'est donc pas vue. Définissez-la dans le véritable environnement du processus : l'environnement du conteneur, ou `env[NAME]` dans un pool php-fpm.

Pour la même raison, un nom de variable qu'une requête ou le serveur web peut fournir est refusé, quelle que soit sa casse. Appeler directement `env('HTTP_HOST')` lève une `InvalidArgumentException` ; le même nom dans un fichier YAML (`debug: !env HTTP_HOST`) lève une `ConfigurationException` dont le message est précédé de la balise et de la clé. Les noms refusés sont ceux qui commencent par `HTTP_`, `REDIRECT_`, `ORIG_`, `SSL_` ou `H2_`, les noms CGI et serveur comme `REMOTE_ADDR`, `QUERY_STRING`, `HTTPS` ou `SERVER_NAME`, et tout nom contenant `=` ou un octet NUL.

```text
!env tag at "application.debug": "HTTP_HOST": names starting with HTTP_ can be set per request by the client request headers, so they are never read as configuration; rename the variable.
```

`env('HTTP_HOST')` lève le même message sans le préfixe `!env tag at "application.debug": `.

### La fonction utilitaire env()

`env()` est la même lecture pour votre propre code. Elle retourne la valeur par défaut lorsque la variable n'est pas définie, et convertit les chaînes `true`, `false`, `null` et `empty` (éventuellement entre parenthèses) en leurs valeurs natives.

```php
$debug = env('APP_DEBUG', false);
$from = env('MAIL_FROM', 'no-reply@example.com');
```

## Environnements

`application.environment` accepte `production` (ou `prod`), `staging` (ou `stage`), `testing` (ou `test`) et `development` (ou `dev`, `local`), sans égard à la casse. Toute autre valeur, ainsi qu'une clé absente, signifie la production : la valeur par défaut est la plus stricte. La valeur est une énumération `Environment`, et `isProductionLike()` est vrai pour la production et la préproduction.

```php
use Zephyrus\Core\Config\Environment;

Environment::fromString('local');               // Environment::Development
Environment::fromString('banana');              // Environment::Production
Environment::Staging->isProductionLike();       // true
```

`application.debug` vaut `true` par défaut en développement et en test, et `false` en production et en préproduction. Dans un environnement de type production, l'application force le débogage à off quoi que dise le fichier : voir [Erreurs](../errors/).

## Validation stricte

Une clé qu'une section intégrée ne connaît pas interrompt le démarrage avec une `ConfigurationException` qui nomme la clé acceptée la plus proche, ou qui énumère les clés acceptées :

```text
Configuration section 'security' field 'max_bdy_size' is an unknown key: did you mean "max_body_size"?
Configuration section 'session' field 'max_body_size' is an unknown key: the accepted keys are name, lifetime, httpOnly, secure, sameSite, cookiePath, idleTimeout.
Configuration section 'security' sets both 'maxBodySize' and 'max_body_size': keep one.
```

Une clé de premier niveau proche du nom d'une section intégrée est refusée elle aussi :

```text
Configuration key 'sesion' is not a known section: did you mean "session"? A section of your own needs a factory registered under its name in the $sectionFactories argument of the Configuration factories.
```

Les valeurs sont également vérifiées. Les booléens n'acceptent que `true`/`false`, `1`/`0`, `on`/`off` et `yes`/`no`, et les tailles sont des nombres d'octets :

```text
Configuration section 'application' field 'debug' has invalid value "maybe": is not a boolean; use true/false, 1/0, on/off or yes/no.
Configuration section 'security' field 'max_body_size' has invalid value "2M": must be a number of bytes, for example 2097152 (no unit suffix).
```

Lisez ces messages comme des instructions : ils nomment la section, la clé et ce qu'il faut changer.

## Vos propres sections

Toute autre clé de premier niveau est ignorée à moins que vous n'enregistriez une section pour elle. Une section est une sous-classe de `ConfigSection` dont `fromArray()` lit des valeurs typées :

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

Passez la classe sous le nom de la section en second argument, puis relisez la section avec `section()` :

```php
$config = Configuration::fromYamlFile(
    __DIR__ . '/config.yml',
    ['billing' => BillingConfig::class],
);

$config->section('billing')->trialDays; // 14
$config->hasSection('billing');         // true
```

`ConfigSection` offre `get()`, `getString()`, `getInt()`, `getFloat()`, `getBool()`, `getArray()` et `has()`. Les clés imbriquées utilisent des points (`smtp.host`), et `trialDays` comme `trial_days` retrouvent la même valeur. Les secrets que vous déclarez dans une propriété `$secretKeys` sont masqués par `toArray()`.

Le `MailerConfig` du framework est une section de ce type. Enregistrez-le sous la forme `['mailer' => MailerConfig::class]` pour configurer SMTP depuis le YAML : voir [Courriel](../../digging-deeper/mail/).

### Bon à savoir

- Une section personnalisée ne refuse pas les clés inconnues : une clé mal orthographiée y prend silencieusement sa valeur par défaut.
- Une fabrique enregistrée sous un nom intégré (`database`, quelle que soit la graphie), sous un nom vide, ou deux fabriques qui nomment la même section lèvent une `InvalidArgumentException`.
- `section('database')` lève aussi une exception : lisez les sections intégrées par leur propriété typée, `$config->database`.

## Plusieurs fichiers

Lorsque les réglages diffèrent d'une machine à l'autre, fusionnez des fichiers. Les fichiers suivants remplacent les précédents, clé par clé :

```php
$config = Configuration::fromOptionalYamlFiles([
    __DIR__ . '/config.yml',
    __DIR__ . '/config.local.yml', // skipped when it does not exist
]);
```

| Méthode | Lit | Fichier manquant |
| --- | --- | --- |
| `fromYamlFile($path)` | un fichier YAML | lève une exception |
| `fromYamlFiles($paths)` | plusieurs fichiers YAML, fusionnés | lève une exception |
| `fromOptionalYamlFiles($paths)` | plusieurs fichiers YAML, fusionnés | ignoré |
| `fromFile($path)` | un fichier YAML, ou un fichier PHP qui retourne un tableau | lève une exception |
| `fromFiles($paths)` | plusieurs fichiers YAML ou PHP, fusionnés | lève une exception |
| `fromOptionalFiles($paths)` | plusieurs fichiers YAML ou PHP, fusionnés | ignoré |
| `fromArray($array)` | un tableau imbriqué | |
| `defaults()` | rien : chaque section utilise ses valeurs par défaut | |

Toutes prennent la table des sections personnalisées comme dernier argument. Un fichier manquant, un fichier qui ne s'analyse pas et une balise `!env` refusée lèvent une `ConfigurationException`.

## Lire des valeurs n'importe où

Passez la `Configuration` au builder et elle devient disponible par `App::getConfiguration()` et la fonction utilitaire `config()` :

```php
config('security', 'maxBodySize');  // 2097152
config('billing', 'trialDays', 30); // a custom section, with a default
config('database');                 // the typed DatabaseConfig, or null
```

`config()` retourne la valeur par défaut que vous passez lorsqu'aucune configuration n'a été définie ou que la propriété est absente. Elle lève une exception pour une section intégrée écrite autrement que par son nom exact (`config('Database')`).

`$config->toArray()` exporte l'arbre pour inspection. Les secrets (le mot de passe de la base de données, la clé de chiffrement, le mot de passe du service de courriel) sont remplacés par `[redacted]` à moins que vous ne passiez `true`, ce qui n'a sa place ni près d'un panneau de débogage ni dans un journal.

## Variables de démarrage

Pour les déploiements qui choisissent leur configuration depuis l'environnement, `ApplicationBootstrap::fromEnvironment()` construit une `Application` à partir d'un répertoire de fichiers de configuration PHP :

| Variable | Signification | Valeur par défaut |
| --- | --- | --- |
| `APP_CONFIG_DIR` | répertoire contenant les fichiers | `./config` |
| `APP_CONFIG_BASE` | nom de fichier de base | `app` |
| `APP_ENV` | suffixe d'environnement | aucune |
| `APP_CONFIG_EXTRA` | suffixes supplémentaires séparés par des virgules | aucune |

Elle exige `<dir>/<base>.php`, puis fusionne `<base>.local.php`, `<base>.<APP_ENV>.php` et chaque `<base>.<extra>.php` lorsqu'ils existent. Avec `APP_ENV=stage`, `config/app.php` est lu, puis `config/app.stage.php` le remplace. Ces fichiers retournent des tableaux et suivent les mêmes règles strictes. Un nom d'environnement ou de base qui contient un séparateur de chemin est refusé.

```php
use Zephyrus\Core\Bootstrap\ApplicationBootstrap;

$app = ApplicationBootstrap::fromEnvironment();
$response = $app->handle($request);
```

La même classe offre `fromConfigDirectory()`, `fromConfigurationFile()`, `fromConfigurationArray()` et `fromConfigFiles()` lorsque vous passez vous-même les chemins. Une application dotée de sa propre classe de démarrage, comme dans [L'application](../application/), n'a besoin d'aucune d'elles.

### Bon à savoir

- Les booléens écrits avec `!env` ont besoin d'une valeur par défaut : `debug: !env APP_DEBUG, false`. Une variable non définie et sans valeur par défaut est lue comme `null`, et un réglage booléen refuse `null`.
- `allowed_hosts: []` accepte tous les hôtes. Une chaîne vide ou `null` est refusé.
- `security.csrf`, `security.encryption` et `security.headers` doivent être des tableaux associatifs (`csrf: { enabled: false }`).
- `security.max_body_size` est en octets, un entier ou une chaîne de chiffres. `2M` et `1.5` sont refusés.
- `build()` définit aussi le fuseau horaire à partir de `localization.timezone`, dont la valeur par défaut est `UTC`.
