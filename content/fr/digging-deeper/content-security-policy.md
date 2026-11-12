---
title: Content-Security-Policy
order: 2
description: Envoyez une Content-Security-Policy avec un nonce neuf à chaque requête, utilisez le nonce dans les gabarits Latte, commencez en mode rapport seulement et resserrez la politique étape par étape.
---

# Content-Security-Policy

Seulement les scripts que vous avez voulu exécuter.

Une Content-Security-Policy indique au navigateur d’où une page peut charger des scripts, des styles, des images et des cadres. Son rôle principal est de limiter les attaques par injection de scripts intersites : si un attaquant réussit à placer un `<script>` dans votre HTML, une politique qui n’autorise que vos propres scripts empêche le navigateur de l’exécuter.

Zephyrus vous offre deux classes : `ContentSecurityPolicy`, un constructeur immuable de la valeur de l’en-tête, et `ContentSecurityPolicyMiddleware`, qui l’envoie et ajoute un nonce neuf à chaque requête.

## Une politique de départ

```php
use Zephyrus\Security\ContentSecurityPolicy;
use Zephyrus\Security\ContentSecurityPolicyMiddleware;
use Zephyrus\Security\SecureHeadersMiddleware;

$policy = ContentSecurityPolicy::create()
    ->withDirective('default-src', "'self'")
    ->withDirective('script-src', "'self'")
    ->withDirective('style-src', "'self'")
    ->withDirective('img-src', ["'self'", 'data:'])
    ->withDirective('connect-src', "'self'")
    ->withDirective('object-src', "'none'")
    ->withDirective('base-uri', "'none'")
    ->withDirective('form-action', "'self'")
    ->withDirective('frame-ancestors', "'none'");

$builder = $builder
    ->withMiddleware(new SecureHeadersMiddleware($config->security->headers))
    ->withMiddleware(new ContentSecurityPolicyMiddleware($policy, nonceDirectives: ['script-src']));
```

Chaque réponse porte alors un en-tête comme celui-ci :

```text
content-security-policy: default-src 'self'; script-src 'self' 'nonce-Sfgc2xN1mst83eLYCnU1LA=='; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

Ce que fait chaque directive ici :

| Directive | Valeur | Effet |
| --- | --- | --- |
| `default-src` | `'self'` | Tout ce qui n’a pas sa propre directive se charge uniquement depuis votre origine. |
| `script-src` | `'self'` et le nonce | Fichiers de script de votre origine, et scripts en ligne portant le nonce de cette requête. |
| `style-src` | `'self'` | Feuilles de style de votre origine ; les `<style>` et `style=""` en ligne sont bloqués. |
| `img-src` | `'self' data:` | Images de votre origine et images `data:` en ligne. |
| `connect-src` | `'self'` | `fetch()` et `XMLHttpRequest` vers votre origine seulement. |
| `object-src` | `'none'` | Aucun plugin (`<object>`, `<embed>`). |
| `base-uri` | `'none'` | Aucune balise `<base>`, qui pourrait rediriger toutes les URL relatives. |
| `form-action` | `'self'` | Les formulaires n’envoient leurs données qu’à votre origine. |
| `frame-ancestors` | `'none'` | Aucun site ne peut intégrer vos pages dans un cadre (la forme moderne de `X-Frame-Options: DENY`). |

Ajoutez une source là où votre application en a besoin, par exemple `->appendValue('img-src', 'https://images.example.com')` pour un hôte d’images.

## Des nonces dans les gabarits

Un nonce est une valeur aléatoire que le serveur place à la fois dans l’en-tête et sur chaque balise de script qu’il approuve. Un script injecté ne peut pas la deviner : le navigateur refuse donc de l’exécuter. Placez `nonce()` sur chaque balise `<script>`, en ligne ou non :

```latte
<!doctype html>
<html lang="en">
<head>
    <link rel="stylesheet" href="/css/app.css">
    <script nonce="{nonce()}" src="/js/app.js" defer></script>
</head>
<body>
    <button type="button" id="save">Save</button>
    <script nonce="{nonce()}">
        document.getElementById('save').addEventListener('click', () => console.log('saved'));
    </script>
</body>
</html>
```

La page s’affiche avec la même valeur que l’en-tête :

```text
<script nonce="Sfgc2xN1mst83eLYCnU1LA==" src="/js/app.js" defer></script>
```

- Le nonce fait 16 octets aléatoires, encodés en base64, produits avant l’exécution de votre contrôleur. `nonce()` retourne la même valeur pour toutes les balises d’une requête, et la requête suivante en reçoit une nouvelle.
- Rien n’ajoute l’attribut à votre place : une balise qui en est dépourvue est bloquée, et c’est voulu.
- Les gestionnaires d’événements en ligne (`onclick="..."`) et les URL `javascript:` ne peuvent pas porter de nonce et sont bloqués. Attachez les gestionnaires depuis un script avec `addEventListener`, comme ci-dessus.
- Pour autoriser aussi les blocs `<style>` en ligne munis d’un nonce, inscrivez la directive : `nonceDirectives: ['script-src', 'style-src']`.
- Ne mettez jamais en cache une page portant un nonce dans un cache partagé : chaque visiteur recevrait le même nonce, et un attaquant qui le lit une fois pourrait le réutiliser.

## Construire une politique

`ContentSecurityPolicy` est immuable : chaque méthode retourne une nouvelle politique.

```php
$policy = ContentSecurityPolicy::create()
    ->withDirective('default-src', "'self'")
    ->withDirective('script-src', "'self' https://cdn.example.com") // a string is split on whitespace
    ->withDirective('img-src', ["'self'", 'data:'])                   // or pass an array
    ->appendValue('img-src', 'https://images.example.com')            // adds one source, skips duplicates
    ->withDirective('upgrade-insecure-requests');                     // a directive with no value

$policy->hasDirective('IMG-SRC');      // true: names are case-insensitive
$policy->withoutDirective('img-src');  // a copy without the directive
$policy->toArray();                    // ['default-src' => ["'self'"], 'script-src' => [...], ...]
$policy->toHeaderValue();              // the header value, also what (string) $policy returns
ContentSecurityPolicy::create()->isEmpty(); // true
```

`withDirective()` remplace une directive ; `appendValue()` y ajoute. Les valeurs sont vérifiées à mesure qu’elles sont ajoutées, de sorte qu’un caractère égaré ne peut pas casser une politique :

```text
->appendValue('script-src', "'self' 'unsafe-inline'")
  A CSP directive value must be a single source expression and cannot contain whitespace.
->withDirective('script-src', "'self'; object-src *")
  CSP directive "script-src" cannot contain a separator (";", CR or LF).
```

### Empreintes

Un extrait en ligne fixe sur lequel vous ne pouvez pas mettre de nonce (une balise tierce collée telle quelle) peut être autorisé par son empreinte à la place. `appendHash()` prend l’algorithme (`sha256`, `sha384` ou `sha512`) et le condensé en base64 du contenu exact entre les balises :

```php
$policy = $policy->appendHash('style-src', 'sha256', base64_encode(hash('sha256', 'body{margin:0}', true)));
// style-src 'self' 'sha256-IAdwN3biDCQ3brrgp1m8kBEsPQYyqfREKOEfeoREopc='
```

Toute modification de l’extrait, même une seule espace, change l’empreinte et le bloque. `appendNonce('script-src', $nonce)` existe pour un nonce que vous gérez vous-même ; avec le middleware, utilisez plutôt `nonceDirectives`.

## Le middleware

`new ContentSecurityPolicyMiddleware($policy, reportOnly: false, nonceDirectives: [])` accepte :

- `$policy` : une `ContentSecurityPolicy`, ou une simple chaîne pour une politique sans nonce. Une chaîne ne peut pas recevoir de nonce : `new ContentSecurityPolicyMiddleware("default-src 'self'", nonceDirectives: ['script-src'])` lance `A nonce requires a ContentSecurityPolicy instance, a raw policy string cannot be extended.`
- `reportOnly` : envoie plutôt `Content-Security-Policy-Report-Only`, de sorte que le navigateur signale les violations sans rien bloquer.
- `nonceDirectives` : les directives qui reçoivent le nonce de la requête. Vide (la valeur par défaut), la politique est envoyée telle que construite.

### Avec SecureHeadersMiddleware

`security.headers.csp` envoie une politique statique par `SecureHeadersMiddleware` (voir [en-têtes de sécurité](../../fundamentals/security/#en-têtes-de-sécurité)). Quand vous utilisez ce middleware, laissez cette clé vide. Si les deux sont définis et que ce middleware est monté en premier, `build()` refuse, puisque sa politique ne serait jamais envoyée :

```text
ContentSecurityPolicyMiddleware is registered before SecureHeadersMiddleware, whose csp is set, so the policy registered first is never sent. Register ContentSecurityPolicyMiddleware after SecureHeadersMiddleware, or leave SecureHeadersConfig::csp empty.
```

### Une route avec sa propre politique

Une réponse qui porte déjà l’en-tête le conserve. Une page destinée à être intégrée dans un cadre par un partenaire définit la sienne :

```php
#[Get('/embed')]
public function embed(): Response
{
    return $this->render('page')
        ->withHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors https://partner.example.com");
}
```

Cette politique remplace entièrement celle du middleware, nonce compris : écrivez la politique complète dont la page a besoin. Avec `application.debug` activé, le middleware avertit sur une telle route que « the nonce policy was not applied because Content-Security-Policy is already set on the response » ; sur une route qui définit volontairement sa propre politique, cet avertissement est attendu.

## Rapport seulement et rapports de violations

Activer une politique sur une application existante bloquera quelque chose que vous avez oublié. Commencez en mode rapport seulement : le navigateur exécute tout, et vous dit ce que la politique aurait bloqué.

```php
$builder = $builder->withMiddleware(new ContentSecurityPolicyMiddleware(
    $policy->withDirective('report-uri', '/csp-reports'),
    reportOnly: true,
    nonceDirectives: ['script-src'],
));
```

```text
content-security-policy-report-only: default-src 'self'; script-src 'self' 'nonce-SYgRgoVRa5R4hJCvw1M8Ew=='; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; report-uri /csp-reports
```

Les navigateurs envoient chaque violation en JSON à `report-uri`. Le point d’accès est appelé sans votre jeton CSRF : il doit donc être inscrit sous `security.csrf.exceptions`, sans quoi chaque rapport est refusé par un 403 :

```yaml
security:
  csrf:
    exceptions: ['#^/csp-reports$#']
```

```php
#[Post('/csp-reports')]
public function report(Request $request): Response
{
    $report = json_decode($request->body()->raw(), true);
    if (is_array($report)) {
        error_log('CSP violation: ' . json_encode($report['csp-report'] ?? $report, JSON_UNESCAPED_SLASHES));
    }

    return $this->noContent();
}
```

N’importe qui peut envoyer des données à cette route : réencoder le rapport avec `json_encode()` garde un rapport forgé sur une seule ligne de journal, et `MaxBodySizeMiddleware` en borne la taille. Ne stockez ni n’affichez des rapports sans les traiter comme des entrées non fiables.

## Resserrer la politique

1. Montez la politique de départ avec `reportOnly: true` et la route de rapports.
2. Parcourez chaque page, puis lisez les rapports. Pour chacun, déplacez le script en ligne dans un fichier ou donnez-lui le nonce, remplacez les gestionnaires en ligne par `addEventListener`, et ajoutez les hôtes que vous utilisez vraiment (`appendValue('img-src', ...)`).
3. Quand les rapports cessent, passez à `reportOnly: false`. Gardez la directive `report-uri` pour être informé de ce que vous avez manqué.
4. Resserrez ensuite davantage : gardez `'unsafe-inline'` et `'unsafe-eval'` hors de `script-src`, ajoutez `upgrade-insecure-requests` une fois que tout est servi en HTTPS, et, avec les nonces en place, envisagez `->appendValue('script-src', "'strict-dynamic'")`, qui permet à vos scripts munis d’un nonce de charger leurs propres dépendances et ignore les listes d’hôtes dans les navigateurs qui le prennent en charge.

Plusieurs `ContentSecurityPolicyMiddleware` qui prennent des nonces partagent un seul nonce par requête : le premier le produit, les autres et `nonce()` le réutilisent. Une politique appliquée et un essai en rapport seulement peuvent donc nommer tous deux le nonce que porte la page :

```php
$kernel = $builder
    ->withMiddleware(new ContentSecurityPolicyMiddleware($enforced, nonceDirectives: ['script-src']))
    ->withMiddleware(new ContentSecurityPolicyMiddleware($trial, reportOnly: true, nonceDirectives: ['script-src']))
    ->build();
```

Les en-têtes `Content-Security-Policy` et `Content-Security-Policy-Report-Only` portent alors la même valeur `'nonce-...'` que les balises produites avec `nonce()`. Avant la version 0.14.1, chaque middleware produisait son propre nonce et `nonce()` retournait celui du plus interne : l’en-tête externe nommait donc un nonce que aucune balise ne portait.

## À savoir

- Un nonce ou une empreinte dans une directive fait ignorer `'unsafe-inline'` par les navigateurs dans cette même directive. Avec `application.debug` activé, le middleware avertit de cette combinaison : `Content-Security-Policy: a nonce was added to script-src, which also contains 'unsafe-inline'. Browsers ignore 'unsafe-inline' when a nonce is present, so inline scripts without the nonce attribute will stop running. Remove one of the two.`
- `frame-ancestors` remplace `X-Frame-Options` dans les navigateurs actuels. Gardez les deux : les navigateurs plus anciens ne lisent que le second.
- Une route ne peut pas contourner le middleware avec `#[WithoutMiddleware]` ; définissez plutôt l’en-tête propre à la route, comme montré plus haut.
- La politique limite les dégâts d’un script injecté ; elle ne remplace pas l’échappement. Latte échappe chaque `{$value}` selon son contexte : faites-en la seule voie par laquelle des données atteignent votre HTML.
