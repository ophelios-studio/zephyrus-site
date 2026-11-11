---
title: Server-sent events
order: 7
description: Stream events from a controller to the browser with SseEmitter and SseEvent, and avoid the session lock and proxy buffering pitfalls.
---

# Server-sent events

One request, many answers.

Server-sent events (SSE) keep one HTTP response open and push text events to the browser as they happen: progress of a job, a notification, a live counter. The browser's `EventSource` reads the stream and reconnects on its own. Zephyrus gives you two small classes: `SseEvent` formats one event and `SseEmitter` streams a generator of events to the client, flushing after each one.

## A streaming endpoint

```php
<?php

declare(strict_types=1);

namespace App\Controllers;

use Generator;
use Zephyrus\Controller\Controller;
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Http\SseEmitter;
use Zephyrus\Http\SseEvent;
use Zephyrus\Routing\Attribute\Get;
use Zephyrus\Routing\Attribute\WithoutMiddleware;
use Zephyrus\Session\SessionMiddleware;

final class StreamController extends Controller
{
    #[Get('/events')]
    #[WithoutMiddleware(SessionMiddleware::class)]
    public function events(Request $request): Response
    {
        $lastId = (int) $request->headers()->get('Last-Event-ID', '0');

        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        set_time_limit(0);

        (new SseEmitter())->emit($this->feed($lastId));

        return Response::noContent();
    }

    /**
     * @return Generator<int, SseEvent>
     */
    private function feed(int $lastId): Generator
    {
        yield new SseEvent(data: '', retry: 5000);

        for ($id = $lastId + 1; $id <= $lastId + 3; $id++) {
            yield new SseEvent(data: json_encode(['count' => $id], JSON_THROW_ON_ERROR), event: 'tick', id: (string) $id);
            sleep(1);
        }

        yield new SseEvent(data: '', event: 'heartbeat');
    }
}
```

`emit()` sends `Content-Type: text/event-stream`, `Cache-Control: no-cache` and `X-Accel-Buffering: no`, then writes each event the generator yields and flushes. Run the endpoint and read it with `curl -N`, which disables curl's own buffering:

```bash
curl -N -i http://127.0.0.1:8431/events
```

The output below is abridged: it lists only the headers the endpoint sets and stops after two events.

```text
HTTP/1.1 200 OK
Connection: close
Content-type: text/event-stream;charset=UTF-8
Cache-Control: no-cache
X-Accel-Buffering: no

retry: 5000
data: 

id: 1
event: tick
data: {"count":1}

id: 2
event: tick
data: {"count":2}

id: 3
event: tick
data: {"count":3}

event: heartbeat
data: 

```

The events arrive one second apart, not all at once at the end.

The controller does three things before streaming: it empties every output buffer (a buffer between PHP and the client holds events back), lifts the time limit, and reads where the client left off. After `emit()` returns, the stream is finished: `Response::noContent()` only satisfies the handler's return type, as the status line and headers are already sent.

## Events

`SseEvent` is a read-only value. Only `data` is required.

```php
$event = new SseEvent(data: "line one\nline two", event: 'note', id: '7', retry: 3000);

echo $event->format();
```

```text
retry: 3000
id: 7
event: note
data: line one
data: line two

```

- `data` is the payload as a string. Send JSON with `json_encode()`. Each line break in `data` becomes its own `data:` line, and the browser joins them back.
- `event` names the event type. The browser delivers a named event to `addEventListener('tick', ...)`, and an unnamed one to `onmessage`.
- `id` is the last event id. The browser remembers it and sends it back as the `Last-Event-ID` request header when it reconnects, so the server can resume where it stopped, as the example does.
- `retry` tells the browser how many milliseconds to wait before reconnecting. `data` is still required, so the first event of the example carries an empty message that `onmessage` receives with empty data.

`event` and `id` must be a single line. A line break or a NUL byte in either throws `InvalidArgumentException`: `SSE field "event" must not contain a newline, a carriage return or a NUL byte.` Never build them from request input without cleaning it first.

## Reading the stream in the browser

```js
const source = new EventSource('/events');

source.addEventListener('tick', (event) => {
  const { count } = JSON.parse(event.data);
  console.log('tick', count, 'last id', event.lastEventId);
});
```

When the server ends the response, `EventSource` reconnects after the `retry` delay and sends `Last-Event-ID`. Call `source.close()` when you are done. Against the endpoint above this prints `tick 1 last id 1`, `tick 2 last id 2` and `tick 3 last id 3`.

## Keeping the connection alive

A proxy or a load balancer closes a connection that stays silent for too long. Send an event now and then even when you have nothing to say. `SseEvent` has no comment line, but a named event with empty data does the job and costs the browser nothing: it only reaches the listeners registered for that name, so `onmessage` and `tick` never see it.

```php
yield new SseEvent(data: '', event: 'heartbeat');
```

PHP notices that a client has gone away when it writes. A loop that sleeps for minutes between events will keep running long after the browser has left, so keep the interval between writes short and end the generator when your own source (a queue, a job state) has nothing more to give.

## Behind a proxy or with a session

### The session lock

PHP's default file session handler locks the session for the whole request. A stream that holds the session keeps every other request from the same browser waiting until the stream ends. Skip the session middleware on the streaming route, as the example does with `#[WithoutMiddleware(SessionMiddleware::class)]`.

With the global `SessionMiddleware` mounted, a plain request sent while the stream was open waited 2.5 seconds, the rest of the stream. The same request with the attribute above answered in 2 milliseconds. These figures are measured with `debug: false`: in development, debug defaults to on and the Tracy integration starts a session (a `tracy-session` cookie), so the lock remains even with the attribute. If the stream needs the identity of the user, read what you need from the session before you start streaming, or authenticate with a token in a middleware (see [Authentication](../../fundamentals/authentication/)).

### Buffering

`emit()` sends `X-Accel-Buffering: no`, which turns off buffering in nginx for the response. Other layers need their own setting: a proxy cache, a CDN, or response compression in the web server can all hold events until the buffer fills. Disable compression and buffering for the streaming path, and test through the real proxy, not only on your machine.

### Workers

One stream occupies one PHP worker for as long as it lasts. A pool of eight workers serves eight streams and nothing else. PHP's built-in server, started with `php -S`, serves one request at a time unless you set `PHP_CLI_SERVER_WORKERS`: a development stream blocks the pages you load while it runs.

### Middleware and headers

The stream starts before the controller returns, so the headers are already sent when the pipeline unwinds. A global middleware that adds headers to the response, such as security headers, does not affect a streamed response. Mount the middleware that must act before the controller (authentication, rate limiting) and do not rely on decoration.

## Good to know

- Empty every output buffer before `emit()`, and `set_time_limit(0)` for a long-lived stream.
- Keep the session lock out of the stream: skip `SessionMiddleware` on the route.
- Authenticate the stream endpoint like any other route. It sits behind your normal pipeline until it starts streaming.
- `event` and `id` are one line each; line breaks in `data` are fine.
- Send a periodic event so that proxies do not drop the connection, and end the generator when the work is over.
- `SseEmitter::emit()` takes a `Generator` of `SseEvent`: any other iterable has to be wrapped in one.
