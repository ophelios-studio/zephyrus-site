---
title: Sécurité
order: 11
description: Comment Zephyrus vérifie votre configuration de sécurité au démarrage, et comment appliquer la protection CSRF, les en-têtes de sécurité, HTTPS, les hôtes autorisés, les proxies de confiance et une limite de taille des requêtes.
---

# Sécurité

Déclarée une fois, appliquée à chaque requête.

Zephyrus livre ses protections sous forme de middlewares que vous montez vous-même, et lit leurs valeurs dans la section `security:` de `config.yml`. Rien sous `security:` n'est appliqué à votre place. À la place, `build()` vérifie que chaque protection déclarée par la configuration est réellement appliquée par un middleware monté, et refuse de démarrer quand il en manque une. Un réglage ne peut pas rester dans le fichier en ayant l'air actif alors que rien ne le lit.

Les sessions sont couvertes sur la [page des sessions](../sessions/), la connexion des utilisateurs sur la [page d'authentification](../authentication/), et l'en-tête Content-Security-Policy sur sa [propre page](../../digging-deeper/content-security-policy/).

## Un bootstrap sécurisé

Voici la section `security:` et le bootstrap d'une application typique servie en HTTPS à `app.example.test` :

```yaml
security:
  force_https: true
  allowed_hosts: [app.example.test]
  max_body_size: 1048576
  trusted_proxies: !env TRUSTED_PROXIES, ''
  csrf:
    enabled: true
    exceptions: ['#^/webhooks/#']
  headers:
    x_frame_options: DENY
    referrer_policy: same-origin
    hsts_max_age: 31536000
    permissions_policy: 'camera=(), microphone=(), geolocation=()'
```

```php
namespace App;

use Zephyrus\Core\Application;
use Zephyrus\Core\ApplicationBuilder;
use Zephyrus\Core\Config\Configuration;
use Zephyrus\Http\Request;
use Zephyrus\Rendering\LatteEngine;
use Zephyrus\Routing\Router;
use Zephyrus\Security\AllowedHostsMiddleware;
use Zephyrus\Security\CsrfConfig;
use Zephyrus\Security\CsrfMiddleware;
use Zephyrus\Security\ForceHttpsMiddleware;
use Zephyrus\Security\MaxBodySizeMiddleware;
use Zephyrus\Security\SecureHeadersMiddleware;
use Zephyrus\Session\SessionCsrfTokenManager;
use Zephyrus\Session\SessionManager;
use Zephyrus\Session\SessionMiddleware;

final class Kernel
{
    public static function run(string $root): void
    {
        $config = Configuration::fromYamlFile($root . '/config.yml');

        $request = Request::fromGlobals(
            trustedProxies: $config->security->trustedProxies,
            trustedHeaders: $config->security->trustedHeaders,
        );

        self::application($root, $config)->handle($request)->send();
    }

    public static function application(string $root, Configuration $config): Application
    {
        $session = new SessionManager();
        $tokens = new SessionCsrfTokenManager($session);

        $views = new LatteEngine($root . '/app/Views', $root . '/cache/latte');
        $views->getLatteEngine()->addFunction('csrfToken', $tokens->getToken(...));

        $router = (new Router())->discoverControllers('App\\Controllers', $root . '/app/Controllers');

        return ApplicationBuilder::create()
            ->withConfiguration($config, basePath: $root)
            ->withRouter($router)
            ->withRenderEngine($views)
            ->withMiddleware(new SecureHeadersMiddleware($config->security->headers))
            ->withMiddleware(new AllowedHostsMiddleware($config->security->allowedHosts))
            ->withMiddleware(new ForceHttpsMiddleware())
            ->withMiddleware(new MaxBodySizeMiddleware($config->security->maxBodySize))
            ->withMiddleware(new SessionMiddleware($config->session, $session))
            ->withMiddleware(new CsrfMiddleware($tokens, CsrfConfig::fromSecurityConfig($config->security)))
            ->build();
    }
}
```

Le premier middleware ajouté s'exécute le plus à l'extérieur. `SecureHeadersMiddleware` vient en premier pour que chaque réponse porte les en-têtes, y compris la redirection, le 400 et le 413 que les middlewares suivants produisent d'eux-mêmes. `AllowedHostsMiddleware` précède `ForceHttpsMiddleware` : dans l'autre ordre, une requête HTTP simple pour n'importe quel `Host` reçoit une redirection 308 pouvant être mise en cache vers cet hôte avant même que l'hôte soit vérifié. `SessionMiddleware` doit s'exécuter avant `CsrfMiddleware`, qui garde son jeton dans la session.

Pour le développement local en HTTP simple, omettez ensemble `force_https` et `ForceHttpsMiddleware` (le middleware redirige toute requête simple vers `https://`, quelle que soit la configuration), ou envoyez `X-Forwarded-Proto: https` depuis un proxy de confiance. Inscrivez aussi l'hôte local dans `allowed_hosts`, par exemple `127.0.0.1`.

`Request::fromGlobals()` ne lit jamais `config.yml` : passez-lui vous-même les réglages de proxy, comme ci-dessus (voir [proxies de confiance](#trusted-proxies-and-the-client-ip)).

## La vérification du câblage au démarrage

Chaque clé que vous écrivez sous `security:` est une promesse. Quand `build()` trouve une clé déclarée qu'aucun middleware global n'applique avec la même valeur, il refuse de démarrer et énumère tous les écarts d'un seul coup. La même configuration sans aucun middleware monté donne :

```text
Zephyrus\Core\Config\ConfigurationException: Configuration declares security settings that this application does not enforce as declared:
  - security.forceHttps is not enforced as declared: mount Zephyrus\Security\ForceHttpsMiddleware with withMiddleware()
  - security.allowedHosts is not enforced as declared: mount new Zephyrus\Security\AllowedHostsMiddleware(...) globally with withMiddleware(), built from the configuration's security->allowedHosts
  - security.csrf is not enforced as declared: mount new Zephyrus\Security\CsrfMiddleware(...) globally with withMiddleware(), built from the configuration's security through CsrfConfig::fromSecurityConfig()
  - security.maxBodySize is not enforced as declared: mount new Zephyrus\Security\MaxBodySizeMiddleware(...) globally with withMiddleware(), built from the configuration's security->maxBodySize
  - security.headers is not enforced as declared: mount new Zephyrus\Security\SecureHeadersMiddleware(...) globally with withMiddleware(), built from the configuration's security->headers

Apply the fix given for each setting, or acknowledge the gap explicitly with ApplicationBuilder::withAcknowledgedSecurityKeys([...]) when the protection is provided elsewhere (a reverse proxy, a wrapping middleware, the web server).
```

Ce que chaque clé déclarée exige :

| Déclaré | À monter avec `withMiddleware()` |
| --- | --- |
| `force_https: true` | `new ForceHttpsMiddleware()` |
| un `allowed_hosts` non vide | `new AllowedHostsMiddleware($config->security->allowedHosts)` |
| `max_body_size` supérieur à 0 | `new MaxBodySizeMiddleware($config->security->maxBodySize)`, ou une limite plus stricte |
| `headers` | `new SecureHeadersMiddleware($config->security->headers)` |
| toute clé `csrf`, avec `enabled` à true | `new CsrfMiddleware($tokens, CsrfConfig::fromSecurityConfig($config->security))` |

La vérification compare les valeurs, pas seulement les classes. Un `MaxBodySizeMiddleware(5000000)` sous `max_body_size: 1048576` est refusé parce qu'il porte « a looser limit (5000000 bytes) than security.maxBodySize (1048576 bytes) », alors qu'une limite plus stricte passe. Un `SecureHeadersMiddleware(SecureHeadersConfig::defaults())` sous une section `headers` déclarée est refusé parce qu'il « carries another configuration ». Un `CsrfMiddleware` construit avec `new CsrfConfig()` est refusé quand `security.csrf.exceptions` énumère un motif qu'il n'exclut pas.

Quand une protection vit réellement à un endroit que `build()` ne peut pas voir (redirection TLS à l'équilibreur de charge, liste d'hôtes autorisés dans le serveur web), nommez cette clé :

```php
$builder = $builder->withAcknowledgedSecurityKeys(['forceHttps', 'security.allowedHosts']);
```

Les noms acceptés sont `forceHttps`, `allowedHosts`, `csrf`, `maxBodySize` et `headers`, seuls ou préfixés par `security.`. Tout autre nom est refusé avec le plus proche : `Unknown security key "max_body_size". Accepted names: forceHttps, allowedHosts, csrf, maxBodySize, headers, each short or prefixed with "security.". Did you mean "maxBodySize"?`

`withoutSecurityWiringCheck()` désactive toute la vérification. Préférez reconnaître la clé en question : la vérification reste alors active pour tous les autres réglages, y compris ceux que vous ajouterez plus tard.

### À savoir

- Seules les clés déclarées sont vérifiées. Une application dont le `config.yml` n'a pas de section `security:` démarre sans aucun middleware de sécurité. C'est un choix valide pour un outil interne, pas un défaut sûr pour un site public.
- `max_body_size` vaut `2097152` quand vous l'omettez, mais rien ne l'applique tant que `MaxBodySizeMiddleware` n'est pas monté.
- Un middleware enregistré sous un nom de route avec `registerMiddleware()`, ou enveloppé dans un autre middleware, ne compte pas. Le refus le dit : « it is registered only under route name 'csrf' ».
- Chaque appel `with*()` retourne un nouveau builder. `$builder->withMiddleware(...)` sur sa propre ligne, résultat ignoré, ne monte rien et reçoit le même refus que l'absence de middleware : enchaînez les appels, ou écrivez `$builder = $builder->withMiddleware(...)`.
- `trusted_proxies`, `trusted_headers` et `encryption` ne sont pas vérifiés : ils sont lus en dehors du builder (par `Request::fromGlobals()` et par votre propre code). La section `session:` ne l'est pas non plus : montez vous-même `SessionMiddleware`.
- Une route ne peut pas contourner un middleware de sécurité. `#[WithoutMiddleware(CsrfMiddleware::class)]` est refusé à l'enregistrement des routes : `Route "POST /hook" cannot skip "Zephyrus\Security\CsrfMiddleware": it is a framework security middleware. Exempt the path under security.csrf.exceptions instead`. Il en va de même pour les middlewares HTTPS, d'hôtes, de taille du corps, d'en-têtes et de Content-Security-Policy.

## La section security

Chaque clé, avec sa valeur par défaut quand vous l'omettez. Les clés sont acceptées en snake_case ou en camelCase, une seule graphie par clé, et une clé inconnue interrompt le démarrage en indiquant la plus proche des clés acceptées.

| Clé | Défaut | Signification |
| --- | --- | --- |
| `force_https` | `false` | Redirige le HTTP simple vers HTTPS. |
| `allowed_hosts` | `[]` | Noms d'hôte auxquels l'application répond. Vide, tous les hôtes sont acceptés. |
| `max_body_size` | `2097152` | Plus grand corps de requête, en octets. `0` signifie illimité. |
| `trusted_proxies` | `[]` | Adresses ou plages CIDR de vos proxies inverses. Vide, aucun n'est approuvé. |
| `trusted_headers` | la famille `X-Forwarded-*` | En-têtes de transfert lus depuis un proxy de confiance. |
| `csrf.enabled` | `true` | Vérifie un jeton sur les requêtes qui modifient l'état. |
| `csrf.exceptions` | `[]` | Motifs de chemins exemptés de la vérification. |
| `encryption.key` | aucune | Clé en base64url pour le [chiffrement](../../digging-deeper/cryptography/). |
| `headers` | les valeurs par défaut ci-dessous | En-têtes de réponse de sécurité. |

Lisez les valeurs par des propriétés typées : `$config->security->allowedHosts`, `$config->security->maxBodySize`, `$config->security->headers` (un `SecureHeadersConfig`). `$config->security->isDeclared('maxBodySize')` indique si le fichier a nommé une clé, ce sur quoi s'appuie la vérification du câblage.

La section est stricte : une valeur qui ferait silencieusement autre chose interrompt le démarrage. Chaque refus est une `ConfigurationException`, présentée avec le réglage qui la provoque :

```text
max_body_size: 2M
  Configuration section 'security' field 'max_body_size' has invalid value "2M": must be a number of bytes, for example 2097152 (no unit suffix).
allowed_hosts: [localhost:8080]
  Configuration section 'security' field 'allowedHosts[0]' has invalid value "localhost:8080": ports are not matched: list "localhost" only.
allowed_hosts: ['https://example.com']
  Configuration section 'security' field 'allowedHosts[0]' has invalid value "https://example.com": drop the scheme, list the host only, such as example.com.
csrf: true
  Configuration section 'security' field 'csrf' must be a mapping, such as csrf: { enabled: false }.
trusted_proxies: ['10.0.0.1/8']
  Configuration section 'security' field 'trustedProxies[0]' has invalid value "10.0.0.1/8": 10.0.0.1/8 covers 10.0.0.0/8; write 10.0.0.1/32 or 10.0.0.0/8.
```

Une clé de type liste peut aussi provenir d'une seule variable d'environnement contenant une valeur séparée par des virgules : avec `HOSTS=app.example.test, www.example.test`, `allowed_hosts: !env HOSTS` se lit comme deux entrées. Les secrets, comme la clé de chiffrement, viennent toujours de l'environnement (`!env`), jamais écrits dans le fichier.

## Protection CSRF

Une falsification de requête intersite est un formulaire sur un autre site qui envoie des données au vôtre : le navigateur joint le témoin de session de votre utilisateur, et sans vérification votre application agirait en conséquence. `CsrfMiddleware` l'arrête avec un jeton synchroniseur : une valeur aléatoire stockée dans la session, que toute requête qui modifie l'état doit renvoyer.

- `GET`, `HEAD`, `OPTIONS` et `TRACE` passent sans jeton. Gardez-les exempts d'effets de bord.
- Toute autre méthode exige le jeton, lu dans le champ de corps `_csrf_token`, ou dans l'en-tête `X-CSRF-Token` quand ce champ est absent.
- Une requête qui ne correspond à aucune route n'est jamais refusée : son 404 ou son 405 est retourné à la place, puisqu'aucun gestionnaire ne s'exécute.

`SessionCsrfTokenManager` stocke dans la session un jeton hexadécimal de 64 caractères la première fois qu'on lui en demande un, et compare les soumissions en temps constant.

### Le jeton dans un formulaire

Aucune injection automatique n'est faite dans votre HTML. Enregistrez une fonction Latte dans le bootstrap (la ligne `csrfToken` ci-dessus), puis affichez le champ caché dans chaque formulaire qui modifie l'état :

```latte
<form method="post" action="/notes">
    <input type="hidden" name="_csrf_token" value="{csrfToken()}">
    <textarea name="body"></textarea>
    <button>Save</button>
</form>
```

### Le jeton dans une requête JavaScript

Placez le jeton une fois dans la page, et envoyez-le dans l'en-tête `X-CSRF-Token` :

```latte
<meta name="csrf-token" content="{csrfToken()}">

<script nonce="{nonce()}">
    const token = document.querySelector('meta[name="csrf-token"]').content;

    fetch('/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify({ body: 'Saved from JavaScript' }),
    });
</script>
```

L'attribut `nonce` sert à la [Content-Security-Policy](../../digging-deeper/content-security-policy/) ; retirez-le si vous n'en envoyez pas.

### Refus

Un jeton absent ou erroné donne un 403, et le gestionnaire ne s'exécute jamais. Un client dont l'en-tête `Accept` contient `text/html` (un navigateur qui soumet un formulaire) reçoit une page en texte brut :

```text
This form could not be verified. Your session may have expired or not been saved. Reload the page and try again.
```

Tout autre client reçoit du JSON : `{"error":"Invalid or missing CSRF token."}`. Pour afficher votre propre page, passez `onFailure`. Il reçoit la requête et un `CsrfFailure` (`CsrfFailure::TokenMissing` ou `CsrfFailure::TokenInvalid`) ; retourner `null` conserve la réponse par défaut :

```php
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Security\CsrfConfig;
use Zephyrus\Security\CsrfFailure;
use Zephyrus\Security\CsrfMiddleware;

$builder = $builder->withMiddleware(new CsrfMiddleware(
    $tokens,
    CsrfConfig::fromSecurityConfig($config->security),
    onFailure: fn (Request $request, CsrfFailure $failure): ?Response
        => str_contains($request->headers()->get('Accept') ?? '', 'text/html')
            ? Response::html('<h1>This page expired. Reload it and try again.</h1>', 403)
            : null,
));
```

Le rappel répond à une requête qu'un attaquant a peut-être forgée : affichez seulement le refus, ne rejouez jamais la requête et n'agissez jamais sur le compte.

### Exempter un chemin

Une route appelée par d'autres serveurs (le webhook d'un fournisseur de paiement) ne peut pas porter le jeton de votre session. Inscrivez-la sous `csrf.exceptions` :

```yaml
security:
  csrf:
    enabled: true
    exceptions:
      - '#^/webhooks/#'
      - '#^/csp-reports$#'
```

Chaque entrée est un motif PCRE comparé au chemin de la requête, et les règles l'empêchent d'exempter plus que prévu :

- Mettez-la entre guillemets. En YAML, un `#` sans guillemets commence un commentaire, et l'entrée se lit comme null. Le chargement du fichier la refuse : `Configuration section 'security' field 'csrfExceptions[0]' has invalid value null: each entry must be a non-empty string; quote a pattern that starts with "#" in YAML.`
- Ancrez-la avec `^`, sinon elle pourrait correspondre au milieu d'un chemin.
- Terminez-la par `/` (la route et tout ce qui se trouve dessous) ou par `$` (ce chemin exact), sinon elle exempterait aussi `/webhooksettings`.

Le fichier se charge avec l'une ou l'autre des deux dernières erreurs. Elles sont refusées quand `CsrfConfig::fromSecurityConfig()` construit la configuration du middleware (dans `application()`, donc au démarrage, avant la première requête), avec une `InvalidArgumentException` :

```text
security.csrf.exceptions[0] must start with "^" so it cannot match in the middle of a path: #/x/# (expected a shape such as #^/webhooks/#).
security.csrf.exceptions[0] must end with "/" (the route and everything under it) or "$" (that exact path), otherwise it also exempts every sibling route sharing the prefix: #^/webhooks# (expected a shape such as #^/webhooks/#).
```

Une route exemptée a perdu sa protection CSRF : elle doit donc authentifier son appelant autrement, typiquement en vérifiant une signature. La [page d'authentification](../authentication/#verifying-a-webhook-signature) en montre un exemple.

### CsrfConfig

`CsrfConfig::fromSecurityConfig($config->security)` lit `csrf.enabled` et `csrf.exceptions`, ce qu'attend la vérification du câblage. Construit à la main, `new CsrfConfig()` accepte `bodyField` (par défaut `_csrf_token`), `headerName` (par défaut `X-CSRF-Token`), `excludedPathPatterns` et `enabled` ; `CsrfConfig::defaults()` équivaut à `new CsrfConfig()`. `CsrfConfig::fromArray()` lit les mêmes réglages depuis un tableau et refuse les clés inconnues.

Pour utiliser un autre magasin de jetons, implémentez `CsrfTokenManagerInterface` : `getToken(): string` et `isTokenValid(string $submitted): bool`, ce dernier comparant en temps constant.

### À savoir

- Renouvelez le jeton quand un utilisateur se connecte, en même temps que l'identifiant de session : la [page d'authentification](../authentication/#signing-in) montre les deux appels.
- `security.csrf.auto_html` et `new CsrfConfig(injectToken: true)` sont refusés : injecter le jeton dans le HTML à la sortie ne peut pas suivre l'analyse du navigateur et pourrait l'envoyer à un autre site.
- `csrf: { enabled: false }` désactive la vérification sans rien monter. Ne le faites que pour une application sans session par témoin.
- Le middleware ne vérifie pas l'en-tête `Origin` et n'utilise pas les témoins `SameSite` à sa place. Le `same_site: Lax` du témoin de session (voir [sessions](../sessions/)) est une deuxième couche, pas un remplacement.

## En-têtes de sécurité

`SecureHeadersMiddleware` ajoute les en-têtes de réponse de sécurité. Sans section `headers:`, `SecureHeadersConfig::defaults()` s'applique :

| En-tête | Défaut | Clé | Pourquoi |
| --- | --- | --- | --- |
| `X-Frame-Options` | `SAMEORIGIN` | `x_frame_options` | Les autres sites ne peuvent pas intégrer vos pages dans un cadre (clickjacking). Utilisez `DENY` si vous n'intégrez jamais vos propres pages. |
| `X-Content-Type-Options` | `nosniff` | `x_content_type_options` | Les navigateurs se fient à votre `Content-Type` au lieu de deviner. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `referrer_policy` | Les chemins et les chaînes de requête restent sur votre site. |
| `X-XSS-Protection` | `0` | `xss_protection` | Le filtre hérité est désactivé : il pouvait être détourné pour retirer des scripts d'une page. |
| `Strict-Transport-Security` | non envoyé | `hsts_max_age`, `hsts_include_subdomains` | Désactivé tant que vous ne fixez pas une durée maximale, car il lie les navigateurs à HTTPS pendant cette durée. |
| `Content-Security-Policy` | non envoyé | `csp` | Aucune politique n'est sûre pour toutes les applications. |
| `Permissions-Policy` | non envoyé | `permissions_policy` | À activer fonctionnalité du navigateur par fonctionnalité. |

Une clé que vous définissez remplace sa valeur par défaut ; une clé que vous omettez la conserve. Une valeur vide (`''`) signifie que l'en-tête n'est pas envoyé. La configuration au haut de cette page envoie :

```text
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: same-origin
x-xss-protection: 0
permissions-policy: camera=(), microphone=(), geolocation=()
strict-transport-security: max-age=31536000
```

`hsts_include_subdomains: true` ajoute `; includeSubDomains`. Activez HSTS une fois que chaque page du domaine est servie en HTTPS, et incluez les sous-domaines seulement si chacun d'eux l'est aussi.

`csp` envoie une politique statique. Pour une politique avec des nonces par requête, laissez `csp` vide et utilisez [ContentSecurityPolicyMiddleware](../../digging-deeper/content-security-policy/). Un `csp` sur plusieurs lignes est refusé : écrivez-le sur une seule ligne ou avec un bloc replié (`>`).

### À savoir

- `Strict-Transport-Security` n'est envoyé que sur les requêtes HTTPS. Derrière un proxy qui termine TLS, la requête ne compte comme HTTPS que si le proxy est approuvé (voir plus bas).
- Un en-tête déjà défini par la route l'emporte, même s'il est plus permissif : une route qui doit être intégrée dans un cadre par un partenaire définit son propre `X-Frame-Options` ou sa propre politique. Le `Content-Security-Policy` d'une route remplace entièrement celui de la configuration ; ils ne sont pas fusionnés. Un en-tête vide défini par une route n'équivaut pas à un retrait.
- Construisez la configuration avec `SecureHeadersConfig::defaults()` ou `SecureHeadersConfig::fromArray([...])` quand vous montez le middleware sans fichier de configuration ; avec une section `headers:` déclarée, passez `$config->security->headers`.

## Forcer HTTPS

`ForceHttpsMiddleware` répond à une requête HTTP simple par une redirection 308 vers les mêmes hôte, chemin et chaîne de requête en HTTPS : `http://app.example.test/notes?page=2` mène à `https://app.example.test/notes?page=2`. Un 308 conserve la méthode et le corps, de sorte qu'un `POST` mal aiguillé n'est pas transformé en `GET` sans avertissement. Le constructeur ne prend aucun argument.

Derrière un équilibreur de charge ou un proxy inverse qui termine TLS, PHP voit du HTTP simple. À moins que le proxy figure dans `trusted_proxies`, chaque requête paraît non sécurisée et le middleware redirige indéfiniment. Soit vous inscrivez le proxy, soit vous laissez le proxy faire la redirection et reconnaissez la clé avec `withAcknowledgedSecurityKeys(['forceHttps'])`.

## Hôtes autorisés

L'en-tête `Host` est choisi par le client. Une application qui construit des liens absolus à partir de celui-ci (un courriel de réinitialisation de mot de passe, une URL canonique, une redirection) peut être amenée à envoyer vos utilisateurs vers le domaine d'un attaquant. `AllowedHostsMiddleware` refuse tout hôte hors de votre liste par un 400 et `{"error":"Invalid Host header."}`.

```yaml
security:
  allowed_hosts:
    - app.example.test
    - '*.example.com'
```

- Une entrée exacte correspond à cet hôte, sans tenir compte de la casse. Un point final est ignoré.
- `*.example.com` correspond à tous les sous-domaines, à toute profondeur (`www.example.com`, `a.b.example.com`), mais jamais à `example.com` lui-même : inscrivez les deux si vous avez besoin des deux.
- Un littéral IPv6 s'écrit `2001:db8::1` ou `[2001:db8::1]`.
- Le port n'est pas comparé : `app.example.test:8443` passe quand `app.example.test` est inscrit. Les entrées avec un port, un schéma, un `*` seul ou un nom non ASCII sont refusées au démarrage (utilisez la forme punycode d'un nom internationalisé).
- Une liste vide accepte tous les hôtes. En production, inscrivez les vôtres.

`$middleware->allows('www.example.com')` applique les mêmes règles en dehors d'une requête, par exemple pour vérifier un hôte lu ailleurs.

## Proxies de confiance et adresse IP du client

Derrière un proxy inverse, `REMOTE_ADDR` est l'adresse du proxy, et le vrai client ainsi que le schéma voyagent dans des en-têtes de transfert que n'importe quel client peut aussi envoyer. `Request::fromGlobals()` ne lit ces en-têtes que lorsque le pair direct figure dans `trusted_proxies` :

```yaml
security:
  trusted_proxies: [10.0.0.5/32]
```

Inscrivez la plage la plus étroite qui couvre vos proxies. Une plage large comme `10.0.0.0/8` sur un réseau partagé permet à n'importe quel hôte interne de forger `X-Forwarded-For` et les autres en-têtes ci-dessous. Pour une requête provenant du proxy `10.0.0.5` portant `X-Forwarded-For: 203.0.113.9` et `X-Forwarded-Proto: https` :

| `trustedProxies` passé à `fromGlobals()` | `clientIp()` | schéma |
| --- | --- | --- |
| aucun | `10.0.0.5` | `http` |
| `['10.0.0.5/32']` | `203.0.113.9` | `https` |

La chaîne de transfert est lue depuis la droite, en sautant les proxies de confiance, et la première adresse non approuvée est le client. Quand le proxy le plus proche ajoute à la suite de `X-Forwarded-For`, un client qui envoie son propre `X-Forwarded-For: 1.2.3.4` n’ajoute qu’une entrée à gauche, qui n’est jamais atteinte : la réponse reste `203.0.113.9`. Un proxy qui transmet tel quel l’en-tête du client laisse la valeur du client comme seule entrée, et le client choisit alors `clientIp()`. Un client qui se connecte directement (sans passer par un proxy de confiance) garde sa propre adresse, quels que soient les en-têtes qu'il envoie.

`trusted_headers` énumère les en-têtes de transfert qu'un proxy de confiance peut définir : par défaut `x-forwarded-for`, `x-forwarded-host`, `x-forwarded-proto` et `x-forwarded-port`. `forwarded`, `x-real-ip`, `cf-connecting-ip` et `x-client-ip` sont aussi compris, mais lus seulement si vous les inscrivez, parce qu'ils ne sont dignes de confiance que lorsque votre proxy le plus proche les écrase. Indiquer `trusted_headers` remplace l'ensemble par défaut : nommez donc chaque en-tête dont vous avez besoin.

L'ensemble par défaut n'est pas sûr derrière tous les proxies. `x-forwarded-for` est lu depuis la droite : une valeur ajoutée en tête par le client n’est donc jamais atteinte, pourvu que le proxy le plus proche ajoute à la suite de l’en-tête ou l’écrase. `x-forwarded-host`, `x-forwarded-proto` et `x-forwarded-port` sont lus depuis la gauche : la première valeur de la liste l'emporte. Un proxy qui ajoute à la suite d'un en-tête envoyé par le client laisse la valeur du client en premier, et le client choisit alors l'hôte et le schéma que voit votre application. Avec un pair de confiance qui transmet `X-Forwarded-Host: evil.example, app.example.test` et `X-Forwarded-Proto: https, http`, `Request::uri()` répond `https://evil.example`, et avec un `allowed_hosts` vide, un lien de réinitialisation de mot de passe construit à partir de celui-ci pointe vers `evil.example`.

Les en-têtes de transfert ne sont donc dignes de confiance que lorsque le proxy le plus proche les écrase ou, pour `X-Forwarded-For`, ajoute à la suite. Un proxy qui laisse passer le `X-Forwarded-For` du client permet au client de choisir `clientIp()` et de contourner `IpAllowlistGuard`. Dans nginx :

```nginx
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Port $server_port;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Apache `mod_proxy` ajoute à la suite de `X-Forwarded-Host` par défaut, ce qui est le cas non sécuritaire. Quand le proxy n'écrase pas un en-tête, retirez-le de l'ensemble approuvé. Avec seulement l'adresse du client approuvée, la même requête se résout en `http://app.example.test` :

```yaml
security:
  trusted_proxies: [10.0.0.5/32]
  trusted_headers: [x-forwarded-for]
```

Sans `x-forwarded-proto`, une requête qu'un proxy a terminée en TLS n'est plus vue comme HTTPS : appliquez donc HTTPS au proxy et reconnaissez `forceHttps` (voir [forcer HTTPS](#forcing-https)). `allowed_hosts` est le filet de sécurité pour tous les en-têtes d'hôte, transmis ou non : inscrivez vos hôtes en production. Avec `app.example.test` inscrit, la requête ci-dessus reçoit un 400. Il ne vérifie pas les ports : un `X-Forwarded-Port` que le proxy n’écrase pas doit sortir de l’ensemble approuvé, sans quoi un client peut mettre son propre port dans les URL générées.

`['*']` approuve tous les pairs. Il existe pour le développement local derrière un proxy de conteneur ; en production, il permet à n'importe quel client de choisir sa propre adresse.

### IpRange

`Zephyrus\Http\IpRange` est le comparateur derrière `trusted_proxies` et la [garde par liste d'adresses IP autorisées](../authentication/#the-built-in-guards) :

```php
use Zephyrus\Http\IpRange;

IpRange::contains('10.0.0.0/8', '10.20.30.40');   // true
IpRange::contains('2001:db8::/32', '2001:db8::1'); // true
IpRange::contains('192.0.2.10', '192.0.2.10');     // true: no prefix means an exact match
IpRange::contains('10.0.0.0/8', 'not-an-ip');      // false: unparsable input never matches
IpRange::isValid('10.0.0.1/8');                    // false
IpRange::invalidEntryReason('10.0.0.1/8');         // "10.0.0.1/8 covers 10.0.0.0/8; write 10.0.0.1/32 or 10.0.0.0/8"
```

Une plage dont des bits sont activés après son préfixe (`10.0.0.1/8`) est refusée, car elle veut rarement dire ce qu'elle dit, de même qu'une plage IPv6 mappée IPv4 plus courte que `/96` (`::ffff:10.0.0.0/8` couvre bien plus que `10.0.0.0/8`).

## Taille du corps de la requête

`MaxBodySizeMiddleware` refuse une requête dont le corps dépasse sa limite, avant le démarrage de la session et avant l'exécution de votre route :

```php
$builder = $builder->withMiddleware(new MaxBodySizeMiddleware($config->security->maxBodySize));
```

Il mesure le `Content-Length` déclaré lorsqu'il est valide, sinon le corps brut. Le refus est un 413 : du texte brut (`Request body too large.`) quand l'en-tête `Accept` contient `text/html`, sinon `{"error":"Request body too large."}`. Le deuxième argument remplace ce message : écrivez-le donc dans la langue de vos utilisateurs :

```php
$builder = $builder->withMiddleware(new MaxBodySizeMiddleware(
    $config->security->maxBodySize,
    'This file is larger than the 1 MB limit.',
));
```

Pour répondre vous-même, passez `onFailure`. Il reçoit la requête et un `BodyTooLarge` portant `bytes` (la taille mesurée ou déclarée) et `maxBytes` ; retourner `null` conserve la réponse par défaut :

```php
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Security\BodyTooLarge;
use Zephyrus\Security\MaxBodySizeMiddleware;

$builder = $builder->withMiddleware(new MaxBodySizeMiddleware(
    $config->security->maxBodySize,
    onFailure: fn (Request $request, BodyTooLarge $refusal): ?Response
        => Response::html('<h1>That file is too large (limit ' . $refusal->maxBytes . ' bytes).</h1>', 413),
));
```

### À savoir

- C'est un budget, pas une défense. Au moment où PHP s'exécute, le serveur web a déjà lu le corps. Fixez aussi la limite du serveur lui-même (`client_max_body_size` dans nginx, `LimitRequestBody` dans Apache) ainsi que `post_max_size` et `upload_max_filesize` de PHP.
- Les téléversements multipart sont analysés par PHP avant l'exécution de votre code : leur corps brut est donc vide et seul `Content-Length` compte.
- `bytes` reprend ce que le client a déclaré et peut être absurdement grand. Montrez `maxBytes` à l'utilisateur, pas `bytes`.
- `new MaxBodySizeMiddleware(0)` est illimité ; une limite négative est refusée.

## Liste de vérification pour la production

Avant le premier déploiement, et de nouveau chaque fois que la configuration change :

- `application.debug` est désactivé. `build()` le désactive de toute façon quand `environment` vaut `production` ou `staging` (un nom non reconnu compte comme production), sauf si le bootstrap appelle `withProductionDebugAcknowledged()`. Pour voir la sortie de débogage depuis une seule machine, utilisez la liste de clients de débogage décrite sur la [page des erreurs](../errors/).
- `force_https: true`, ou HTTPS appliqué à l'équilibreur de charge et reconnu avec `withAcknowledgedSecurityKeys(['forceHttps'])`.
- `hsts_max_age` défini une fois que chaque page est servie en HTTPS.
- `allowed_hosts` énumère vos noms d'hôte.
- `trusted_proxies` énumère vos proxies, jamais `'*'`, et est passé à `Request::fromGlobals()`.
- `max_body_size` correspond à ce dont vos formulaires ont besoin, et les limites du serveur web et de `post_max_size` sont aussi définies.
- Chaque formulaire qui modifie l'état affiche le champ `_csrf_token`, et chaque entrée de `csrf.exceptions` authentifie son appelant autrement.
- Le témoin de session est `secure` et `http_only` (voir [sessions](../sessions/)), et l'identifiant de session ainsi que le jeton CSRF sont renouvelés à la connexion.
- Les secrets (`encryption.key`, mot de passe de la base de données, jetons d'API) viennent de `!env`, pas du fichier.
- Une Content-Security-Policy est envoyée, au moins en mode rapport seulement pendant que vous l'ajustez.
- L'application démarre sans `withoutSecurityWiringCheck()`, et chaque clé reconnue nomme une protection que vous pouvez montrer du doigt.
