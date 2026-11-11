---
title: HTTP
order: 6
description: Lisez les requêtes avec des accesseurs typés, construisez des réponses immuables et émettez-les vers le SAPI de PHP.
---

# HTTP

Chaque réponse, explicite.

`Request` et `Response` sont les deux objets valeurs que chaque partie de Zephyrus s’échange. Une requête se lit par de petites parties typées; une réponse se construit une seule fois et n’est jamais modifiée sur place : chaque méthode `with*()` retourne une copie.

## Construire une requête

Dans `public/index.php`, construisez la requête à partir des superglobales de PHP :

```php
use Zephyrus\Http\Request;

$request = Request::fromGlobals(
    trustedProxies: $config->security->trustedProxies,
    trustedHeaders: $config->security->trustedHeaders,
);
```

`fromGlobals()` ne lit pas `config.yml` : transmettez vous-même les réglages de mandataire (voir [Sécurité](../security/) pour ce que change un mandataire de confiance). Dans un test, ou n’importe où hors d’une requête web, utilisez `fromArray()` :

```php
$request = Request::fromArray(
    'POST',
    'https://app.example.test:8443/api/items?sort=name&tags[]=a&tags[]=b#x',
    body: ['name' => 'Atlas'],
    headers: ['Content-Type' => 'application/json', 'X-Request-Id' => 'abc', 'Authorization' => 'Bearer t0k'],
    cookies: ['theme' => 'dark'],
    clientIp: '203.0.113.9',
);
```

## Méthode, chemin et URI

```php
$request->method;                // 'POST' (a property, always upper-case)
$request->isMethod('post');      // true (case-insensitive)
$request->path();                // '/api/items'
$request->uri()->scheme();       // 'https'
$request->uri()->host();         // 'app.example.test'
$request->uri()->port();         // 8443
$request->uri()->queryString();  // 'sort=name&tags[]=a&tags[]=b'
$request->uri()->fragment();     // 'x'
$request->uri()->isSecure();     // true
$request->uri()->baseUrl();      // 'https://app.example.test:8443'
$request->uri()->full();         // the whole URL
```

Utilisez `path()` pour les décisions comme les gardes et les listes autorisées : c’est le chemin tel qu’envoyé, encore encodé en pourcentage, ce que le routeur fait correspondre. `uri()->path()` sert à l’affichage. Un segment de paramètre reste encodé dans `path()`; lisez sa valeur décodée avec `routeParameter()`.

Depuis `fromGlobals()`, un `POST` portant un champ `_method` ou un en-tête `X-HTTP-Method-Override` valant `PUT`, `PATCH` ou `DELETE` est routé comme cette méthode. `fromArray()` n’applique pas la substitution.

## Chaîne de requête

```php
$request->query('sort');            // 'name'
$request->query('tags');            // ['a', 'b']
$request->query('missing', 'dflt'); // 'dflt'
$request->query;                    // the whole array
```

Les valeurs sont des chaînes ou des tableaux de chaînes : convertissez-les et validez-les avant de les utiliser.

## Corps

`body()` retourne un `RequestBody` : les champs de formulaire ou l’objet JSON analysés, plus la chaîne brute.

```php
$request->body()->get('name');   // 'Atlas'
$request->body()->get('age', 0); // default when absent
$request->body()->has('name');   // true
$request->body()->all();         // ['name' => 'Atlas']
$request->body()->isEmpty();     // false
$request->body()->raw();         // the body exactly as received
$request->body()->isMalformed(); // true when a JSON body could not be decoded
```

Un corps JSON est lu lorsque le `Content-Type` de la requête est `application/json` (ou un type `+json`). Un corps JSON mal formé se lit comme vide, alors vérifiez `isMalformed()` avant de valider et répondez vous-même 400. `raw()` est ce dont vous avez besoin pour vérifier la signature d’un webhook.

`getParameter($name)` lit d’abord le corps, puis la chaîne de requête, et `getParameters()` fusionne les deux : pratique pour les formulaires qui acceptent l’un ou l’autre, mais des appels explicites à `query()` et `body()` disent d’où vient une valeur.

## En-têtes

`headers()` retourne un `HeaderBag` insensible à la casse :

```php
$request->headers()->get('x-request-id');   // 'abc'
$request->headers()->has('X-REQUEST-ID');   // true
$request->headers()->bearerToken();         // 't0k'
$request->headers()->contentType();         // 'application/json'
$request->headers()->isJson();              // true
$request->headers()->all();                 // every header, lower-cased names
$request->getHeader('X-Missing', 'fallback'); // shortcut with a default
```

`bearerToken()` retourne le jeton qui suit `Bearer ` dans `Authorization`, ou `null`. Passez un autre nom d’en-tête ou un autre préfixe en arguments pour un schéma personnalisé.

## Témoins (cookies)

`cookies()` retourne un `CookieJar` en lecture seule des témoins envoyés par le navigateur :

```php
$request->cookies()->get('theme');       // 'dark'
$request->cookies()->get('x', 'none');   // default
$request->cookies()->has('theme');       // true
$request->cookies()->all();              // ['theme' => 'dark']
```

Le témoin de session est géré pour vous par le [middleware de session](../sessions/). `Response` n’a pas d’assistant pour les témoins, et poser un témoin sur une réponse a des effets de bord : voir [Témoins sur une réponse](#témoins-sur-une-réponse).

## Fichiers téléversés

```php
$request->file('avatar');      // ?FileUpload
$request->filesOf('photos');   // list of FileUpload for a multi-file field
```

Stocker un téléversement de façon sûre est le rôle de `Uploader` : voir [Téléversements](../../digging-deeper/uploads/).

## Paramètres de route et attributs

Les attributs portent des données qu’un middleware a calculées pour le gestionnaire. Les requêtes sont immuables, donc en ajouter un retourne une nouvelle requête :

```php
$next = $request->withAttribute('userId', 7);

$request->attribute('userId');       // null (the original is unchanged)
$next->attribute('userId');          // 7
$next->attribute('userId', 0);       // with a default
$next->withAttributes(['a' => 1]);   // several at once
```

Les paramètres substituables qu’une route a tirés de son URL sont accessibles par `routeParameter('id')`, et `isRouteParameter('id')` indique si une valeur provient de l’URL. Les paramètres substituables sont aussi fusionnés dans les attributs, de sorte qu’une vérification d’autorisation fondée sur un attribut doit d’abord tester `isRouteParameter()` : une valeur d’URL ne dit rien de l’identité de l’appelant. `route()` retourne la `Route` trouvée, ou `null` avant le routage.

## IP du client

```php
$request->clientIp();            // '203.0.113.9' (or null)
$request->clientIp('0.0.0.0');   // with a default
```

Derrière un mandataire inverse, la valeur n’est le client transféré que lorsque le mandataire est déclaré de confiance, ce qui se configure dans [Sécurité](../security/). Un en-tête de transfert provenant d’un pair non fiable est ignoré.

## Construire une réponse

Les fabriques couvrent les cas courants :

```php
use Zephyrus\Http\Response;

Response::text('hello');                 // text/plain; charset=utf-8
Response::html('<p>hi</p>', 201);        // text/html; charset=utf-8
Response::json(['ok' => true], 201);     // application/json; charset=utf-8
Response::noContent();                   // 204, empty
Response::redirect('/login', 303);       // Location header, empty body
Response::localRedirect($next, '/');     // only to a local path, else the fallback
```

Le constructeur permet de bâtir toute autre réponse : `new Response(body: $csv, status: 200, headers: ['Content-Type' => 'text/csv'])`. Le corps d’une réponse est une chaîne conservée en mémoire; pour diffuser en continu, voir [Événements envoyés par le serveur](../../digging-deeper/server-sent-events/).

`Response::json()` lance une exception lorsque la charge utile ne peut pas être encodée (par exemple de l’UTF-8 invalide) plutôt que d’envoyer du JSON corrompu.

`redirect()` envoie là où vous le lui dites : ne lui passez jamais une valeur provenant de la requête. `localRedirect()` n’accepte une cible que si `Response::isLocalPath()` l’approuve : une seule `/` initiale, pas `//`, aucune barre oblique inverse, aucun caractère de contrôle. Tout le reste (`//evil.example`, `https://evil.example`, une valeur qui n’est pas une chaîne) va vers la valeur de repli, et une valeur de repli qui n’est pas elle-même locale lance `InvalidArgumentException`.

## Statut et en-têtes

```php
$response = Response::html('<p>hi</p>', 201);

$response->status;           // 201
$response->statusPhrase();   // 'Created'
$response->toStatusLine();   // 'HTTP/1.1 201 Created'

$changed = $response
    ->withHeader('X-A', '1')
    ->withHeaders(['X-B' => '2', 'X-C' => '3'])
    ->withoutHeader('x-a')
    ->withStatus(202);

$changed->hasHeader('X-B');        // true
$changed->getHeader('x-b');        // '2' (any case)
$changed->toHeaderLines();         // ['content-type: text/html; charset=utf-8', 'x-b: 2', 'x-c: 3']
```

Les noms d’en-têtes sont stockés en minuscules, donc `$response->headers['X-B']` vaut `null` alors que `$response->headers['x-b']` vaut `'2'` : utilisez `getHeader()`.

`withHeader()` et `withHeaders()` valident ce que vous leur donnez. Un nom contenant une espace lance `Invalid HTTP header name "Bad Name": a field name may only contain RFC 9110 token characters.`; une valeur contenant un saut de ligne lance `Invalid value for HTTP header "X-A": it contains a control character other than HTAB.` Cela ferme la porte à l’injection d’en-têtes lorsqu’une valeur provient d’une saisie utilisateur. Pour vérifier une valeur au préalable, utilisez `Response::isValidHeaderValue($value)`.

## Immuabilité

Une `Response` est en lecture seule : assigner à `$response->status` est une erreur, et chaque méthode `with*()` retourne un nouvel objet. L’original n’est jamais modifié.

```php
$base = Response::text('hi');
$cached = $base->withHeader('Cache-Control', 'no-store');

$base->hasHeader('Cache-Control');   // false
$cached->hasHeader('Cache-Control'); // true
```

Il en va de même pour `Request` : `withAttribute()` retourne une copie. Un middleware qui décore doit retourner le nouvel objet.

## Témoins sur une réponse

`Response` n’offre aucune API de témoins, et ses en-têtes ne contiennent qu’une valeur par nom, donc une réponse porte un seul en-tête `Set-Cookie` :

```php
Response::noContent()->withHeader(
    'Set-Cookie',
    'theme=dark; Path=/; Secure; HttpOnly; SameSite=Lax',
);
```

Posez toujours `Secure`, `HttpOnly` et une valeur `SameSite`, et construisez la valeur à partir de données de confiance seulement. Pour l’état de connexion, utilisez la session, qui pose son propre témoin.

> **Attention :** l’émetteur envoie chaque en-tête avec `header()`, qui remplace les en-têtes `Set-Cookie` que PHP a déjà mis en file. Un `Set-Cookie` sur une réponse supprime donc tous les autres témoins de cette requête : le témoin de session compris, de sorte qu’un visiteur qui n’en a pas ne reçoit aucun témoin de session sur cette réponse, et tout appel à `setcookie()` fait plus tôt dans la requête est perdu. Gardez plutôt la valeur dans la session, ou n’envoyez le témoin de réponse que sur une réponse où aucun témoin de session ni autre témoin n’est posé.

## Émettre une réponse

`Application::handle()` retourne une `Response`; quelque chose doit l’envoyer. Le contrôleur frontal habituel :

```php
use Zephyrus\Http\SapiEmitter;

(new SapiEmitter())->emit($app->handle(Request::fromGlobals()));
```

`SapiEmitter` écrit la ligne de statut et les en-têtes, puis le corps par morceaux (8192 octets par défaut; `new SapiEmitter(chunkSize: 4096)` le change, et une taille inférieure à 1 lance `InvalidArgumentException`). Si les en-têtes ont déjà été envoyés, il les ignore et écrit le corps. `$response->send()` fait la même chose en un seul appel, sans découpage.

`EmitterInterface` n’a qu’une seule méthode, `emit(Response $response): void`. Implémentez-la pour un double de test qui capture la réponse en mémoire au lieu d’écrire vers le SAPI.

## Bon à savoir

- `fromArray()` est destiné aux tests : il n’analyse pas un corps JSON brut (construisez un `RequestBody` avec `malformed: true` pour tester ce cas) et n’applique pas la substitution de méthode.
- `$request->query` et `$request->attributes` sont des tableaux publics, mais lisez-les par `query()` et `attribute()` et ne les modifiez jamais : utilisez `withAttribute()`.
- Les noms d’en-têtes de réponse sont mis en minuscules au stockage : utilisez `getHeader()` et `hasHeader()` plutôt que le tableau `headers` quand la casse compte.
- Ne passez jamais une valeur de la requête à `redirect()` ni à un en-tête : utilisez `localRedirect()` et le `withHeader()` qui valide.
- Un corps JSON mal formé se lit comme vide : vérifiez `isMalformed()`.
- L’IP du client n’est aussi fiable que votre configuration de mandataires de confiance.
