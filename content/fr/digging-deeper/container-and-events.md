---
title: Conteneur et événements
order: 1
description: Enregistrer et câbler automatiquement des services avec le Container, et réagir au cycle de vie du noyau avec l’EventDispatcher, les événements et les abonnés.
---

# Conteneur et événements

Câblez vos services une fois, écoutez là où vous en avez besoin.

Deux petits blocs de base se trouvent sous l’application : un conteneur d’injection de dépendances qui construit vos contrôleurs, et un répartiteur d’événements synchrone que le noyau utilise pour annoncer chaque requête, chaque réponse et chaque erreur. Les deux sont facultatifs, et les deux sont des classes ordinaires sans état global.

## Le conteneur

`Zephyrus\Container\Container` crée des objets. La plupart du temps, vous n’enregistrez rien : il lit le constructeur typé d’une classe et construit les dépendances qu’il nomme.

```php
interface Clock
{
    public function now(): \DateTimeImmutable;
}

final class SystemClock implements Clock
{
    public function now(): \DateTimeImmutable
    {
        return new \DateTimeImmutable();
    }
}

final class Greeter
{
    public function __construct(private readonly string $greeting = 'Hello')
    {
    }

    public function greet(string $name): string
    {
        return $this->greeting . ', ' . $name;
    }
}

final class Invoicer
{
    public function __construct(private readonly Clock $clock, private readonly Greeter $greeter)
    {
    }
}
```

`Greeter` n’a besoin d’aucun enregistrement, car son seul paramètre a une valeur par défaut. `Invoicer` demande une `Clock`, une interface : le conteneur ne peut donc pas deviner quelle classe vous voulez. Liez-la :

```php
use Zephyrus\Container\Container;

$container = new Container();
$container->bind(Clock::class, fn (Container $c): Clock => new SystemClock());

$invoicer = $container->get(Invoicer::class); // Clock bound, Greeter auto-wired
```

### Enregistrer des services

| Méthode | Comportement |
| --- | --- |
| `bind($id, $factory)` | la fabrique s’exécute à chaque `get()` : un nouvel objet chaque fois |
| `singleton($id, $factory)` | la fabrique s’exécute une seule fois, et son résultat est retourné par chaque `get()` suivant |
| `instance($id, $value)` | retourne la valeur que vous avez construite vous-même |
| `get($id)` | résout une entrée : valeur en cache, fabrique de singleton, fabrique liée, puis câblage automatique |
| `make($id)` | comme `get()`, mais construit un objet neuf même pour une fabrique de singleton |
| `has($id)` | `true` pour une entrée enregistrée ou une classe qui peut être chargée |

Une fabrique reçoit le conteneur : elle peut donc en tirer d’autres entrées :

```php
$container->singleton(Greeter::class, fn (): Greeter => new Greeter('Invoice'));
$container->instance('app.name', 'Example');

$container->get(Greeter::class) === $container->get(Greeter::class); // true: a singleton
$container->get(Clock::class) === $container->get(Clock::class);     // false: a bind
$container->make(Greeter::class) === $container->get(Greeter::class); // false: make() is always fresh
```

Un identifiant est généralement un nom de classe, mais il peut être n’importe quelle chaîne (`'app.name'`). Enregistrer de nouveau le même identifiant remplace l’entrée précédente, quelle que soit la méthode qui l’a enregistrée.

### Règles du câblage automatique

Pour une classe sans entrée, le conteneur lit le constructeur et remplit chaque paramètre à tour de rôle :

- Un type de classe ou d’interface est résolu avec `get()` : ses propres dépendances sont donc câblées aussi.
- Un paramètre doté d’une valeur par défaut l’utilise.
- Un paramètre variadique typé `string`, `int`, `float`, `bool` ou `array` ne reçoit aucun argument.
- Un objet câblé automatiquement n’est pas mis en cache. Enregistrez un `singleton()` lorsqu’une instance doit être partagée.

Tout ce qu’il ne peut pas remplir est une erreur qui dit quoi faire :

```text
NotFoundException: No binding found and [App\Services\Clock] is not a resolvable class.
ContainerException: Cannot auto-wire parameter $apiUrl of [App\Services\NeedsString]: it has the built-in type string, which the container cannot provide, and no default value; give it a default value, or bind [App\Services\NeedsString] explicitly.
ContainerException: Circular dependency detected while resolving [App\Services\LoopA].
```

`NotFoundException` étend `ContainerException`, qui étend `ZephyrusRuntimeException` : interceptez le parent pour traiter les deux. Les interfaces et les classes abstraites ont toujours besoin d’une liaison. Les scalaires comme une URL de base ou une clé relèvent d’une fabrique, lus depuis la [configuration](../../fundamentals/configuration/) :

```php
$container->singleton(Gateway::class, fn (): Gateway => new Gateway(config('billing', 'provider')));
```

`ContainerInterface` est le contrat derrière la classe : il ne contient que `get()` et `has()`, avec la sémantique de PSR-11 et sans dépendance à `psr/container`. Typez-y votre code lorsqu’il ne fait que lire depuis un conteneur, et passez votre propre implémentation à `withContainer()` si vous en préférez une autre.

### Des contrôleurs câblés automatiquement

Donnez le conteneur au builder et chaque contrôleur est construit par son intermédiaire :

```php
$app = ApplicationBuilder::create()
    ->withConfiguration($config, basePath: $root)
    ->withRouter($router)
    ->withContainer($container)
    ->build();
```

Un contrôleur déclare alors ce dont il a besoin dans son constructeur, comme dans [L’application](../../fundamentals/application/#des-contrôleurs-construits-par-le-conteneur). `withContainer()` est un raccourci de `withControllerFactory()` : le dernier des deux que vous appelez l’emporte. Avec une fabrique, vous décidez comment chaque classe est construite :

```php
$builder = $builder->withControllerFactory(
    fn (string $class): object => new $class(new Greeter('Salut')),
);
```

### Bon à savoir

- `has()` ne charge une classe que lorsque l’identifiant a la forme d’un nom de classe : il ne charge donc jamais automatiquement une chaîne arbitraire.
- Un `has()` qui retourne `true` ne garantit pas que `get()` réussira : le constructeur peut encore contenir un paramètre que le conteneur ne peut pas remplir.
- Le conteneur vous appartient, dans la classe de démarrage. Le passer à des services pour qu’ils aillent chercher eux-mêmes leurs dépendances cache ce dont ils ont besoin : prenez plutôt la dépendance dans le constructeur.

## Le répartiteur d’événements

`Zephyrus\Event\EventDispatcher` est synchrone : `dispatch()` appelle chaque écouteur, dans l’ordre, et retourne l’événement. Un événement est une classe qui étend `Event` et porte des données :

```php
use Zephyrus\Event\Event;

final class OrderPlaced extends Event
{
    public function __construct(public readonly int $orderId, public readonly string $email)
    {
    }
}
```

```php
use Zephyrus\Event\EventDispatcher;

$events = new EventDispatcher();
$events->addListener(OrderPlaced::class, function (OrderPlaced $event): void {
    error_log('order ' . $event->orderId . ' placed');
});

$events->dispatch(new OrderPlaced(7, 'ada@example.com'));
```

Un écouteur est n’importe quel appelable qui prend l’événement. Le répartiteur n’est pas celui du noyau : vous pouvez en créer autant que vous le voulez, et les utiliser aussi pour vos propres événements.

### Priorités

`addListener($eventClass, $listener, $priority = 0)` accepte une priorité. La plus élevée s’exécute en premier, et les écouteurs de même priorité s’exécutent dans l’ordre d’enregistrement.

```php
$events->addListener(OrderPlaced::class, $second);          // priority 0
$events->addListener(OrderPlaced::class, $first, 10);       // runs before $second
```

Un écouteur peut interrompre la chaîne avec `$event->stopPropagation()` : aucun écouteur après lui ne s’exécute, quelle que soit sa priorité. Le drapeau n’est jamais réinitialisé : émettez donc un nouvel objet d’événement plutôt que le même deux fois.

Un écouteur enregistré sur une classe parente ou sur une interface reçoit aussi l’événement. À priorité égale, la classe exacte s’exécute en premier, puis ses parents, puis ses interfaces. Un écouteur sur `Event::class` entend tout :

```php
$events->addListener(Event::class, fn (Event $e) => error_log($e::class), -5);
```

### Abonnés

Un abonné regroupe plusieurs écouteurs dans une seule classe. Il implémente `EventSubscriberInterface` et retourne une table qui associe la classe d’événement à une méthode, ou à `[method, priority]` :

```php
use Zephyrus\Event\EventSubscriberInterface;

final class OrderSubscriber implements EventSubscriberInterface
{
    public static function getSubscribedEvents(): array
    {
        return [
            OrderPlaced::class => ['onOrderPlaced', 5],
        ];
    }

    public function onOrderPlaced(OrderPlaced $event): void
    {
        // send the receipt
    }
}

$events->addSubscriber(new OrderSubscriber());
```

`addSubscriber()` vérifie d’abord chaque entrée : une faute de frappe dans un nom de méthode échoue donc à l’enregistrement, avant qu’aucun écouteur ne soit ajouté :

```text
InvalidArgumentException: Subscriber Bad declares the listener "nope" for App\Events\OrderPlaced, but Bad has no public method "nope".
```

### Autres méthodes

| Méthode | Usage |
| --- | --- |
| `removeListener($eventClass, $listener)` | désenregistre un écouteur ; il ne se passe rien s’il n’est pas trouvé |
| `removeSubscriber($subscriber)` | désenregistre tous les écouteurs d’un abonné |
| `hasListeners($eventClass)` | `true` lorsqu’un écouteur est enregistré sur cette classe exacte |
| `getListeners($eventClass)` | les écouteurs de cette classe exacte, par ordre de priorité |
| `applicableListeners($eventClass)` | chaque écouteur qu’un `dispatch` appellerait, parents et interfaces compris |

### Lorsqu’un écouteur lève une exception

Par défaut, une exception dans un écouteur interrompt la répartition et atteint l’appelant. Passez une fonction de rappel en second argument de `dispatch()` pour continuer : l’échec va à la fonction de rappel, et les autres écouteurs s’exécutent tout de même.

```php
$events->dispatch(new OrderPlaced(1, 'ada@example.com'), function (\Throwable $failure, Event $event): void {
    error_log('listener failed: ' . $failure::class);
});
```

Le noyau émet ainsi ses propres événements, pour l’événement d’exception.

## Événements du noyau

Donnez un répartiteur au builder et `HttpKernel` annonce chaque requête. Sans répartiteur, aucun événement n’est émis.

```php
$app = $builder->withEventDispatcher($events)->build();
```

| Événement | Émis | Un écouteur peut |
| --- | --- | --- |
| `RequestEvent` | avant le routage | répondre de lui-même avec `setResponse()` |
| `ResponseEvent` | après la construction de la réponse | la lire ou la remplacer avec `getResponse()` et `setResponse()` |
| `ExceptionEvent` | lorsqu’un objet jetable devient une réponse d’erreur | l’observer : voir [Erreurs](../../fundamentals/errors/#écouter-les-erreurs) |

Les trois étendent `KernelEvent`, dont `getRequest()` retourne la `Request` courante. Un écouteur sur `KernelEvent::class` les entend donc tous.

`RequestEvent::setResponse()` court-circuite la requête : le routage et les middlewares sont sautés, aucun écouteur de `RequestEvent` ultérieur ne s’exécute, et la réponse passe tout de même par `ResponseEvent`. C’est l’endroit pour une page de maintenance ou un refus anticipé. `hasResponse()` et `getResponse()` lisent ce qu’un écouteur précédent a défini.

### KernelSubscriber

`KernelSubscriber` est une classe de base pour les deux événements côté requête. Redéfinissez `onRequest()` et `onResponse()`, et laissez celui dont vous n’avez pas besoin :

```php
use Zephyrus\Core\KernelSubscriber;
use Zephyrus\Core\RequestEvent;
use Zephyrus\Core\ResponseEvent;
use Zephyrus\Http\Response;

final class MaintenanceSubscriber extends KernelSubscriber
{
    public function onRequest(RequestEvent $event): void
    {
        if ($event->getRequest()->path() === '/maintenance') {
            $event->setResponse(Response::text('Back soon', 503));
        }
    }

    public function onResponse(ResponseEvent $event): void
    {
        $event->setResponse($event->getResponse()->withHeader('X-App', 'example'));
    }
}

$events->addSubscriber(new MaintenanceSubscriber());
```

Les deux méthodes ne font rien par défaut. Redéfinissez les méthodes statiques `requestPriority()` ou `responsePriority()` pour changer l’ordre par rapport aux autres écouteurs (la plus élevée s’exécute en premier, `0` par défaut). `KernelSubscriber` ne couvre pas `ExceptionEvent` : ajoutez-lui un écouteur, comme dans [Erreurs](../../fundamentals/errors/).

### Bon à savoir

- Les écouteurs de `RequestEvent` et de `ResponseEvent` qui lèvent une exception ne sont pas interceptés : l’exception atteint `handle()`. Gardez-les petits, ou interceptez à l’intérieur.
- Un remplacement par `ResponseEvent`, comme un court-circuit par `RequestEvent`, ne passe pas par les middlewares globaux : il n’est pas décoré de vos en-têtes de sécurité. Ajoutez l’en-tête dans l’écouteur, ou au niveau du serveur web.
- Les événements ne sont ni mis en file ni différés : un écouteur lent ralentit la requête.
