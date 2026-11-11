---
title: Container and events
order: 1
description: Register and auto-wire services with the Container, and react to the kernel lifecycle with the EventDispatcher, events and subscribers.
---

# Container and events

Wire your services once, listen where you need to.

Two small building blocks sit under the application: a dependency injection container that builds your controllers, and a synchronous event dispatcher that the kernel uses to announce each request, response and error. Both are optional, and both are plain classes with no global state.

## The container

`Zephyrus\Container\Container` creates objects. Most of the time you do not register anything: it reads the typed constructor of a class and builds the dependencies it names.

```php
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

`Greeter` needs nothing registered, because its only parameter has a default. `Invoicer` asks for a `Clock`, an interface, so the container cannot guess which class you want. Bind it:

```php
use Zephyrus\Container\Container;

$container = new Container();
$container->bind(Clock::class, fn (Container $c): Clock => new SystemClock());

$invoicer = $container->get(Invoicer::class); // Clock bound, Greeter auto-wired
```

### Register services

| Method | Behaviour |
| --- | --- |
| `bind($id, $factory)` | the factory runs on every `get()`: a new object each time |
| `singleton($id, $factory)` | the factory runs once, and its result is returned by every later `get()` |
| `instance($id, $value)` | returns the value you built yourself |
| `get($id)` | resolves an entry: cached value, singleton factory, bound factory, then auto-wiring |
| `make($id)` | like `get()`, but builds a fresh object even for a singleton factory |
| `has($id)` | `true` for a registered entry or a class that can be loaded |

A factory receives the container, so it can pull other entries:

```php
$container->singleton(Greeter::class, fn (): Greeter => new Greeter('Invoice'));
$container->instance('app.name', 'Example');

$container->get(Greeter::class) === $container->get(Greeter::class); // true: a singleton
$container->get(Clock::class) === $container->get(Clock::class);     // false: a bind
$container->make(Greeter::class) === $container->get(Greeter::class); // false: make() is always fresh
```

An id is usually a class name, but it can be any string (`'app.name'`). Registering the same id again replaces the earlier entry, whichever method registered it.

### Auto-wiring rules

For a class with no entry, the container reads the constructor and fills each parameter in turn:

- A class or interface type is resolved with `get()`, so its own dependencies are wired too.
- A parameter with a default value uses it.
- A variadic parameter typed `string`, `int`, `float`, `bool` or `array` receives no argument.
- An auto-wired object is not cached. Register a `singleton()` when one instance must be shared.

Anything it cannot fill is an error that says what to do:

```text
NotFoundException: No binding found and [App\Services\Clock] is not a resolvable class.
ContainerException: Cannot auto-wire parameter $apiUrl of [App\Services\NeedsString]: it has the built-in type string, which the container cannot provide, and no default value; give it a default value, or bind [App\Services\NeedsString] explicitly.
ContainerException: Circular dependency detected while resolving [App\Services\LoopA].
```

`NotFoundException` extends `ContainerException`, which extends `ZephyrusRuntimeException`: catch the parent to handle both. Interfaces and abstract classes always need a binding. Scalars such as a base URL or a key belong in a factory, read from the [configuration](../../fundamentals/configuration/):

```php
$container->singleton(Gateway::class, fn (): Gateway => new Gateway(config('billing', 'provider')));
```

`ContainerInterface` is the contract behind the class: it holds `get()` and `has()` only, with PSR-11 semantics and no `psr/container` dependency. Type against it when your code only reads from a container, and pass your own implementation to `withContainer()` if you prefer another one.

### Auto-wired controllers

Hand the container to the builder and every controller is built through it:

```php
$app = ApplicationBuilder::create()
    ->withConfiguration($config, basePath: $root)
    ->withRouter($router)
    ->withContainer($container)
    ->build();
```

A controller then declares what it needs in its constructor, as in [The application](../../fundamentals/application/#controllers-through-the-container). `withContainer()` is shorthand for `withControllerFactory()`: whichever of the two you call last wins. With a factory you decide how each class is built:

```php
$builder = $builder->withControllerFactory(
    fn (string $class): object => new $class(new Greeter('Salut')),
);
```

### Good to know

- `has()` only loads a class when the id is shaped like a class name, so it never autoloads an arbitrary string.
- `has()` returning `true` does not promise that `get()` succeeds: the constructor may still hold a parameter the container cannot fill.
- The container is yours to keep in the bootstrap class. Passing it to services so they can fetch their own dependencies hides what they need: take the dependency in the constructor instead.

## The event dispatcher

`Zephyrus\Event\EventDispatcher` is synchronous: `dispatch()` calls every listener, in order, and returns the event. An event is a class that extends `Event` and carries data:

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

A listener is any callable that takes the event. The dispatcher is not the kernel's: you can create as many as you like, and use them for your own events too.

### Priorities

`addListener($eventClass, $listener, $priority = 0)` takes a priority. Higher runs first, and listeners with the same priority run in registration order.

```php
$events->addListener(OrderPlaced::class, $second);          // priority 0
$events->addListener(OrderPlaced::class, $first, 10);       // runs before $second
```

A listener can stop the chain with `$event->stopPropagation()`: no listener after it runs, whatever its priority. The flag is never reset, so dispatch a new event object rather than the same one twice.

A listener registered on a parent class or an interface also receives the event. Among equal priorities the exact class runs first, then its parents, then its interfaces. A listener on `Event::class` hears everything:

```php
$events->addListener(Event::class, fn (Event $e) => error_log($e::class), -5);
```

### Subscribers

A subscriber groups several listeners in one class. It implements `EventSubscriberInterface` and returns a map from event class to method, or to `[method, priority]`:

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

`addSubscriber()` checks every entry first, so a typo in a method name fails at registration, before any listener is added:

```text
InvalidArgumentException: Subscriber Bad declares the listener "nope" for App\Events\OrderPlaced, but Bad has no public method "nope".
```

### Other methods

| Method | Use |
| --- | --- |
| `removeListener($eventClass, $listener)` | unregisters one listener; nothing happens when it is not found |
| `removeSubscriber($subscriber)` | unregisters all of a subscriber's listeners |
| `hasListeners($eventClass)` | `true` when a listener is registered on that exact class |
| `getListeners($eventClass)` | the listeners of that exact class, in priority order |
| `applicableListeners($eventClass)` | every listener a dispatch would call, parents and interfaces included |

### When a listener throws

By default an exception in a listener aborts the dispatch and reaches the caller. Pass a callback as the second argument of `dispatch()` to keep going: the failure goes to the callback, and the remaining listeners still run.

```php
$events->dispatch(new OrderPlaced(1, 'ada@example.com'), function (\Throwable $failure, Event $event): void {
    error_log('listener failed: ' . $failure::class);
});
```

The kernel dispatches its own events this way, for the exception event.

## Kernel events

Give the builder a dispatcher and `HttpKernel` announces each request. Without one, no event fires.

```php
$app = $builder->withEventDispatcher($events)->build();
```

| Event | Fired | A listener can |
| --- | --- | --- |
| `RequestEvent` | before routing | answer on its own with `setResponse()` |
| `ResponseEvent` | after the response is built | read or replace it with `getResponse()` and `setResponse()` |
| `ExceptionEvent` | when a throwable becomes an error response | observe it: see [Errors](../../fundamentals/errors/#listening-to-errors) |

All three extend `KernelEvent`, whose `getRequest()` returns the current `Request`. A listener on `KernelEvent::class` therefore hears all of them.

`RequestEvent::setResponse()` short-circuits the request: routing and the middlewares are skipped, no later `RequestEvent` listener runs, and the response still goes through `ResponseEvent`. It is the place for a maintenance page or an early refusal. `hasResponse()` and `getResponse()` read what a previous listener set.

### KernelSubscriber

`KernelSubscriber` is a base class for the two request-side events. Override `onRequest()` and `onResponse()`, and leave the one you do not need:

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

Both methods default to doing nothing. Override the static `requestPriority()` or `responsePriority()` to change the order against other listeners (higher runs first, default `0`). `KernelSubscriber` does not cover `ExceptionEvent`: add a listener for it, as in [Errors](../../fundamentals/errors/).

### Good to know

- Listeners of `RequestEvent` and `ResponseEvent` that throw are not caught: the exception reaches `handle()`. Keep them small, or catch inside.
- A `ResponseEvent` replacement, like a `RequestEvent` short-circuit, does not pass through the global middlewares: it is not decorated with your security headers. Add the header in the listener, or at the web server.
- Events are not queued or deferred: a slow listener slows the request.
