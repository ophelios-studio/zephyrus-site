---
title: Erreurs et débogage
order: 14
description: Ce que reçoit un client lorsque quelque chose échoue, comment signaler et personnaliser les erreurs, comment le débogueur Tracy est restreint, et comment lire les exceptions du framework.
---

# Erreurs et débogage

Une réponse fixe pour le client, les détails pour vous.

Lorsqu’une exception s’échappe d’un contrôleur ou d’un middleware, `HttpKernel` la transforme en réponse. Le client reçoit une réponse courte et fixe. Le message de l’exception et la trace ne l’atteignent jamais : ils sont destinés à vos journaux. Cette page commence par la configuration sûre à déployer, puis traite chaque élément.

## Une configuration de production sûre

En production, laissez le débogage désactivé et signalez les erreurs au moyen d’un écouteur d’événement. L’environnement décide, et la valeur sûre est celle par défaut :

```yaml
application:
  environment: !env APP_ENV, production
  debug: !env APP_DEBUG, false
```

```php
use Zephyrus\Core\ApplicationBuilder;
use Zephyrus\Core\ExceptionEvent;
use Zephyrus\Event\EventDispatcher;

$events = new EventDispatcher();
$events->addListener(ExceptionEvent::class, function (ExceptionEvent $event): void {
    if (!$event->isRoutingFailure()) { // skip 404 and 405
        error_log($event->getException()::class . ': ' . $event->getException()->getMessage());
    }
});

$app = ApplicationBuilder::create()
    ->withConfiguration($config, basePath: $root)
    ->withRouter($router)
    ->withEventDispatcher($events)
    ->build();
```

Avec cette configuration, une exception qu’aucun gestionnaire ne traite devient un `500` avec un corps fixe, et le framework l’écrit, avec sa trace, dans le journal d’erreurs (`Zephyrus: unhandled exception, answered with a 500: ...`) en plus de la ligne que votre écouteur ajoute. Rien d’autre n’est nécessaire pour une configuration qui ne déclare aucun réglage `security:` (lorsqu’elle en déclare, les middlewares correspondants doivent être montés : voir [Sécurité](../security/)), hormis les réglages PHP ci-dessous. Les gestionnaires d’exceptions plus bas ne changent que ce que voit le client.

`build()` désactive `display_errors` et `display_startup_errors`, sauf si le débogage est actif pour ce démarrage et que le client est de ceux que le débogueur admet (un processus en ligne de commande l’est toujours). Un échec avant l’exécution de `build()`, comme une faute de frappe dans la configuration, est encore affiché avec sa trace et le chemin de `vendor` quand le `display_errors` de PHP est activé, et sa valeur par défaut intégrée est activée lorsqu’aucun `php.ini` n’est chargé. La production exige toujours `display_errors=Off`, `display_startup_errors=Off` et `log_errors=On` : voir [Réglages PHP pour la production](../../getting-started/installation/#réglages-php-pour-la-production).

Sans répartiteur d’événements, un échec n’atteint personne : le client reçoit la réponse fixe et le message est perdu. Enregistrez l’écouteur.

## Ce que le client reçoit

Les réponses intégrées portent un message fixe, jamais celui de l’exception :

| Cause | Statut | Notes |
| --- | --- | --- |
| Aucune route ne correspond, ou un paramètre de route ne se convertit pas vers son type | 404 | `Not Found` |
| Une route existe pour une autre méthode | 405 | `Method Not Allowed`, avec un en-tête `Allow` |
| Une `ValidationException` | 422 | les erreurs de champs, dans les formats JSON seulement |
| Tout le reste | 500 | `Internal Server Error` |

`HttpExceptionResponder` choisit le format d’après l’en-tête `Accept`. Une requête simple, un navigateur (`text/html`) et `*/*` obtiennent `text/plain`. Une requête qui accepte `application/json` obtient une enveloppe construite par `HttpErrorPayload`, et celle qui préfère `application/problem+json` obtient un document de problème :

```text
GET /nope        (Accept: text/html)
404  Not Found

GET /nope        (Accept: application/json)
404  {"error":{"status":404,"message":"Not Found"}}

GET /nope        (Accept: application/problem+json)
404  {"type":"about:blank","title":"Not Found","status":404}

GET /invalid     (Accept: application/json)
422  {"errors":{"email":["Enter a valid email address."]}}
```

Les réponses intégrées ne sont jamais des pages HTML. Une page qui s’harmonise avec votre mise en page, c’est à vous de l’écrire, plus bas.

## Vos propres pages d’erreur

`withExceptionHandler()` associe une classe d’exception à une réponse. Le gestionnaire reçoit l’exception ou l’erreur (`Throwable`) et la requête, et retourne une `Response`, ou `null` pour décliner et conserver la réponse intégrée.

```php
use Zephyrus\Routing\Exception\RouteNotFoundException;
use Zephyrus\Routing\Exception\RouteParameterException;

$notFound = fn (\Throwable $e, Request $request): Response
    => Response::html('<h1>Page not found</h1>', 404);

$builder = $builder
    ->withExceptionHandler(RouteNotFoundException::class, $notFound)
    ->withExceptionHandler(RouteParameterException::class, $notFound);
```

Lorsque plusieurs gestionnaires correspondent, la classe la plus spécifique l’emporte. Un gestionnaire sur `\Throwable` est un filet de sécurité, et il reçoit aussi les exceptions que le framework associe lui-même (`ValidationException`, `MethodNotAllowedException`, `RouteNotFoundException` et `RouteParameterException`). Déclinez pour celles-ci, sinon votre page remplace leurs 422, 405 et 404 :

```php
use Zephyrus\Routing\Exception\MethodNotAllowedException;
use Zephyrus\Routing\Exception\RouteNotFoundException;
use Zephyrus\Routing\Exception\RouteParameterException;
use Zephyrus\Validation\ValidationException;

$builder = $builder->withExceptionHandler(
    \Throwable::class,
    function (\Throwable $e, Request $request): ?Response {
        if (
            $e instanceof ValidationException
            || $e instanceof MethodNotAllowedException
            || $e instanceof RouteNotFoundException
            || $e instanceof RouteParameterException
        ) {
            return null;
        }
        error_log($e::class . ': ' . $e->getMessage());

        return Response::html('<h1>Something went wrong</h1>', 500);
    },
);
```

La page est un texte fixe. Ne placez jamais `$e->getMessage()` ou une trace dans le corps : un message peut contenir un nom d’hôte, un fragment SQL ou un justificatif d’accès. Un gestionnaire ne voit pas les attributs que les middlewares de route posent sur la requête.

Un gestionnaire qui lève lui-même une exception produit le texte fixe du `500`, et l’échec est signalé par un `ExceptionEvent`. L’exception du gestionnaire et celle qu’il traitait sont toutes deux écrites dans le journal d’erreurs. Un gestionnaire d’une page visible par le client devrait aussi examiner `Accept` si la même route sert des clients JSON :

```php
$wantsJson = str_contains($request->headers()->get('accept') ?? '', 'json');
```

## Écouter les erreurs

Le noyau émet un `ExceptionEvent` chaque fois qu’il convertit un `Throwable`, ce qui en fait l’endroit unique pour signaler les erreurs. Un middleware qui intercepte, signale et relance ne les voit jamais : la conversion se produit à l’intérieur du pipeline global, si bien que `$next()` retourne la réponse d’erreur au lieu de lever (sauf si l’exception est relancée pour le débogueur, voir [Déboguer en développement](#déboguer-en-développement)).

| Méthode | Retourne |
| --- | --- |
| `getException()` | le `Throwable` en cours de conversion |
| `getRequest()` | la requête |
| `getSource()` | son origine : `routing`, `handler`, `middleware` ou `responder` |
| `isRoutingFailure()` | `true` pour un 404 ou un 405 |

Les origines sont des constantes de la classe : `ExceptionEvent::SOURCE_ROUTING` (aucune route ne correspond), `SOURCE_HANDLER` (l’action trouvée ou un middleware de route a levé une exception), `SOURCE_MIDDLEWARE` (un middleware global a levé une exception) et `SOURCE_RESPONDER` (un gestionnaire d’exceptions ou le répondeur lui-même a levé une exception).

```php
$events->addListener(ExceptionEvent::class, function (ExceptionEvent $event): void {
    error_log(json_encode([
        'exception' => $event->getException()::class,
        'path' => $event->getRequest()->path(),
        'source' => $event->getSource(),
    ], JSON_THROW_ON_ERROR));
});
```

L’événement sert uniquement à l’observation : un écouteur ne peut pas remplacer la réponse. Un écouteur qui lève une exception est journalisé (`an ExceptionEvent listener failed and was skipped`) et les autres écouteurs s’exécutent tout de même, de sorte qu’un outil de suivi défectueux ne transforme jamais une erreur en page blanche. Voir [Conteneur et événements](../../digging-deeper/container-and-events/) pour le répartiteur.

## Déboguer en développement

Avec `application.debug: true` dans un environnement de développement ou de test, `build()` active le débogueur [Tracy](https://tracy.nette.org). Sans liste d’autorisation, Tracy n’admet un client que sous le serveur intégré de PHP (`php -S`), et seulement un client de bouclage dont la requête ne porte aucun en-tête `X-Forwarded-For`, `Forwarded` ou `X-Real-IP` ; sous PHP-FPM ou toute autre API serveur, personne n’est admis : un développeur derrière FPM doit donc déclarer une liste d’autorisation pour voir la page. La version 0.14.1 admettait un client de bouclage sous toutes les API serveur. Une liste d’autorisation déclarée (ci-dessous) n’admet que ses propres entrées, le bouclage compris. Tracy ne reconnaît un mandataire que par ces en-têtes : le débogage doit donc rester désactivé à moins que chaque mandataire devant PHP en envoie un (nginx : `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). Un client distant derrière un mandataire du même hôte qui n’en ajoute aucun (un simple `proxy_pass`, un tunnel TLS) ressemble à un client local et obtient la page d’erreur complète, sous `php -S` sans liste d’autorisation ou, sous toute API serveur, avec une entrée de bouclage nue : inscrivez plutôt `<secret>@127.0.0.1` et envoyez le témoin. La page comprend les arguments de la trace d’appels et l’environnement : elle ne doit donc jamais atteindre tous les clients.

Avec le débogage actif, une exception qu’aucun gestionnaire ne traite (ou qu’un gestionnaire relance) montre la page de Tracy à un client que le débogueur admet. Tout autre client reçoit le `500` générique, et l’exception va dans le journal d’erreurs. En ligne de commande avec le débogage actif (tests, scripts), elle sort plutôt de `Application::handle()`. `KernelBuilder::withUnhandledExceptionsRethrown()` force ce comportement quel que soit l’indicateur de débogage ; hors d’un test, l’exception atteint alors le gestionnaire propre à PHP. Une exception relancée traverse les middlewares globaux comme une exception, non comme une réponse d’erreur.

Pour obtenir la page de Tracy pour une erreur qu’un gestionnaire fourre-tout traiterait autrement, laissez l’exception sortir de ce gestionnaire, en développement seulement :

```php
$debug = $builder->isDebugEnabledForBoot();

$builder = $builder->withExceptionHandler(
    \Throwable::class,
    function (\Throwable $e, Request $request) use ($debug): ?Response {
        if ($debug) {
            throw $e; // the same object: the kernel passes it on, so Tracy can show it
        }
        error_log($e::class . ': ' . $e->getMessage());

        return Response::html('<h1>Something went wrong</h1>', 500);
    },
);
```

Obtenez `$debug` de `isDebugEnabledForBoot()` sur le builder entièrement configuré (après `withConfiguration()`). Ne le tirez jamais de `$config->application->debug` : en production, cette valeur peut être `true` alors que le débogage est en fait désactivé, et le gestionnaire relancerait alors l’exception et laisserait votre client avec le `500` générique au lieu de votre page. En production, ce gestionnaire répond avec la page fixe ci-dessus et ne relance jamais.

### La production désactive le débogage

En `production` et en `staging`, `build()` désactive le débogage quoi que dise le fichier, et journalise pourquoi :

```text
Zephyrus: application.debug is true while application.environment is production-like. Debug output has been FORCED OFF for this boot: ...
```

Un nom d’environnement non reconnu (`prodution`) équivaut aussi à la production : une faute de frappe échoue donc de façon sûre. Pour déboguer volontairement un environnement en ligne, appelez `withProductionDebugAcknowledged()` dans votre code de démarrage. C’est du code à dessein, et non une clé de configuration : une valeur de configuration est ce qu’on bascule sur un serveur et qu’on oublie. Même alors, les clients ci-dessous (ou le bouclage sous `php -S`, sans liste d’autorisation) sont les seuls censés voir quoi que ce soit, pourvu que la règle du mandataire ci-dessus soit respectée.

```php
$builder = $builder->withProductionDebugAcknowledged();
```

### La liste d’autorisation des clients

Derrière Docker, le navigateur atteint PHP depuis la passerelle du pont, et non depuis le bouclage. Nommez ce client, avec un secret que vous envoyez aussi dans un témoin `tracy-debug`. Le bouclage n’est plus sous-entendu dès qu’une liste existe : inscrivez-le aussi si vous le voulez :

```php
// DEBUG_CLIENTS holds "<secret>@172.17.0.1", <secret> from bin2hex(random_bytes(16)); unset or empty means no allowlist, so loopback only.
$builder = $builder->withDebugClientAllowlist(env('DEBUG_CLIENTS'));
```

Une entrée est une adresse exacte, ou `<secret>@address`, qui exige aussi le témoin `tracy-debug=<secret>`. Une entrée de bouclage nue (`127.0.0.1`, `::1`) n’admet aucune requête qui porte `X-Forwarded-For`, `Forwarded` ou `X-Real-IP` : derrière un mandataire du même hôte, inscrivez `<secret>@127.0.0.1` et envoyez le témoin. La version 0.14.0 admettait le bouclage quelle que soit la liste. Une chaîne peut énumérer plusieurs entrées séparées par des virgules ou des espaces, ou vous pouvez passer un tableau avec une entrée par élément. Les entrées sont vérifiées lorsque vous les enregistrez :

| Entrée | Refus |
| --- | --- |
| `@172.17.0.1` | `Debug client allowlist entry 1 has an empty secret before "@": with no tracy-debug cookie it would admit every client at that address. Set a secret, or list the bare address if that is intended.` |
| `short-secret@172.17.0.1` | `Debug client allowlist entry 1 has a secret shorter than 16 characters before "@": the tracy-debug cookie is all that guards the debugger at that address. Use a longer random secret.` |
| `<secret>@` | `Debug client allowlist entry 1 has no address after "@".` |
| `10.0.0.0/8` | `Debug client allowlist entry 1 is a range: Tracy matches exact addresses only, so list each address.` |
| élément de tableau `'a b'` | `Debug client allowlist entry 1 holds whitespace or a comma: pass each address as its own array entry.` |

Une adresse seule, sans secret, admet quiconque peut atteindre PHP depuis cette adresse : préférez donc `<secret>@address`, avec un secret d’au moins 16 caractères aléatoires, comme `bin2hex(random_bytes(16))` : un secret plus court est refusé. La version 0.16 acceptait tout secret non vide. Les messages nomment la position de l’entrée et ne répètent jamais le secret.

Le secret est un justificatif d’accès. Gardez-le dans l’environnement, jamais dans git. Le framework le garde, avec les autres secrets qu’il connaît, hors de la sortie du débogueur : la propriété de la liste d’autorisation du builder et le témoin `tracy-debug` sont masqués dans les vidages et les traces, tout comme les clés `password`, `token`, `secret`, `apiKey`, `authorization` et `cookie`, la clé de chiffrement, le témoin de session, le corps brut de la requête et les lignes `Set-Cookie` d’une réponse (`Response::$cookies`). `DebugIntegration::SENSITIVE_KEYS` énumère les noms de clés exacts, `SENSITIVE_PROPERTIES` les propriétés masquées, et `isSensitiveKey()` teste une clé. Le Bluescreen masque aussi par motif, mais seulement les valeurs de type chaîne : un secret numérique doit tout de même être ajouté par son nom à `keysToHide` de Tracy.

### Bon à savoir

- Activer le débogueur stocke les vraies valeurs des arguments dans chaque trace d’exception du processus, y compris celles qui ne vont que dans un journal. Gardez le débogage désactivé partout où un journal quitte le serveur.
- `Debugger::enable()` est global et ne peut plus être annulé pour le reste du processus. C’est pourquoi `isDebugEnabledForBoot()` rapporte la décision sans rien activer.
- Tracy est initialisé par `build()`. Vous n’appelez pas vous-même `DebugIntegration::initialize()`.

## Les classes d’exceptions

Chaque refus du framework est une exception dont le message vous dit quoi corriger. Lisez-le comme une instruction : il nomme la section, la clé, la classe ou l’argument, et indique ce qu’il faut changer.

| Classe | Levée pour |
| --- | --- |
| `ZephyrusException` | la classe de base de tout ce qui suit |
| `ZephyrusRuntimeException` | la base des échecs à l’exécution |
| `ConfigurationException` | une configuration invalide, ou un réglage de sécurité non câblé, au démarrage |
| `ContainerException`, `NotFoundException` | une entrée que le conteneur ne peut pas résoudre |
| `RouteNotFoundException`, `RouteParameterException`, `MethodNotAllowedException` | une requête qui ne correspond à aucune route (404, 404, 405) |
| `RouteSignatureException`, `RouteAttributeException`, `RouteMiddlewareException` | une route mal déclarée, détectée au démarrage |
| `ValidationException` | une validation échouée (422), qui porte son `ErrorBag` |
| `SessionException`, `DatabaseException`, `MailerException`, `UploadException`, `RenderException`, `CryptographyException`, `LocalizationException`, `FormatterException`, `FileSystemException` | le module correspondant |

Interceptez `ZephyrusException` pour traiter tout ce que le framework lève volontairement :

```php
use Zephyrus\Core\Config\Configuration;
use Zephyrus\Exceptions\ZephyrusException;

try {
    $config = Configuration::fromYamlFile($root . '/config.yml');
} catch (ZephyrusException $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
```

Une erreur de démarrage s’adresse à vous, et sa place est dans la console ou dans le journal. Elle n’atteint une page que si le `display_errors` de PHP est activé, d’où le réglage à `Off` en production (voir plus haut). Les messages sont assez stables pour qu’on les recherche. Voici ceux que vous rencontrerez en premier :

```text
Configuration key 'sesion' is not a known section: did you mean "session"? ...
Configuration section 'security' field 'max_bdy_size' is an unknown key: did you mean "max_body_size"?
Configuration declares security settings that this application does not enforce as declared: ...
```

Les deux premiers sont traités dans [Configuration](../configuration/#validation-stricte), le troisième dans [Sécurité](../security/). Les messages qui citent une valeur (un nom d’environnement, une classe) échappent les caractères de contrôle, de sorte qu’une ligne de journal ne peut pas être falsifiée par leur entremise.

### Bon à savoir

- Une erreur dans un middleware global est convertie sans rentrer de nouveau dans le pipeline de middlewares : cette réponse ne porte donc aucun en-tête global. Une erreur de gestionnaire est convertie à l’intérieur du pipeline, et les porte.
- `withExceptionHandler()` appelé deux fois pour la même classe remplace le premier gestionnaire.
