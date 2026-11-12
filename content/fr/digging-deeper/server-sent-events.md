---
title: Événements envoyés par le serveur
order: 7
description: Diffusez des événements d’un contrôleur vers le navigateur avec SseEmitter et SseEvent, et évitez les pièges du verrou de session et de la mise en tampon par les mandataires.
---

# Événements envoyés par le serveur

Une requête, plusieurs réponses.

Les événements envoyés par le serveur (SSE) gardent une seule réponse HTTP ouverte et poussent des événements texte vers le navigateur au fur et à mesure qu’ils se produisent : la progression d’une tâche, une notification, un compteur en direct. L’`EventSource` du navigateur lit le flux et se reconnecte de lui-même. Zephyrus vous offre deux petites classes : `SseEvent` formate un événement et `SseEmitter` diffuse vers le client un générateur d’événements, en vidant le tampon après chacun.

## Un point d’accès en diffusion continue

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

`emit()` envoie `Content-Type: text/event-stream`, `Cache-Control: no-cache` et `X-Accel-Buffering: no`, puis écrit chaque événement produit par le générateur et vide le tampon. Exécutez le point d’accès et lisez-le avec `curl -N`, qui désactive la mise en tampon propre à curl :

```bash
curl -N -i http://127.0.0.1:8431/events
```

La sortie ci-dessous est abrégée : elle ne liste que les en-têtes que définit le point d’accès et s’arrête après deux événements.

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

Les événements arrivent à une seconde d’intervalle, et non tous d’un coup à la fin.

Le contrôleur fait trois choses avant de diffuser : il vide chaque tampon de sortie (un tampon entre PHP et le client retient les événements), il lève la limite de temps et il lit où le client s’est arrêté. Une fois que `emit()` retourne, le flux est terminé : `Response::noContent()` ne fait que satisfaire le type de retour du gestionnaire, puisque la ligne de statut et les en-têtes sont déjà envoyés.

## Événements

`SseEvent` est une valeur en lecture seule. Seul `data` est obligatoire.

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

- `data` est la charge utile sous forme de chaîne. Envoyez du JSON avec `json_encode()`. Chaque saut de ligne dans `data` devient sa propre ligne `data:`, et le navigateur les rassemble.
- `event` nomme le type d’événement. Le navigateur remet un événement nommé à `addEventListener('tick', ...)`, et un événement sans nom à `onmessage`.
- `id` est l’identifiant du dernier événement. Le navigateur le mémorise et le renvoie dans l’en-tête de requête `Last-Event-ID` lorsqu’il se reconnecte, de sorte que le serveur peut reprendre là où il s’est arrêté, comme le fait l’exemple.
- `retry` indique au navigateur combien de millisecondes attendre avant de se reconnecter. `data` reste obligatoire, c’est pourquoi le premier événement de l’exemple porte un message vide que `onmessage` reçoit avec des données vides.

`event` et `id` doivent tenir sur une seule ligne. Un saut de ligne ou un octet NUL dans l’un ou l’autre lance `InvalidArgumentException` : `SSE field "event" must not contain a newline, a carriage return or a NUL byte.` Ne les construisez jamais à partir d’une saisie de requête sans la nettoyer d’abord.

## Lire le flux dans le navigateur

```js
const source = new EventSource('/events');

source.addEventListener('tick', (event) => {
  const { count } = JSON.parse(event.data);
  console.log('tick', count, 'last id', event.lastEventId);
});
```

Lorsque le serveur termine la réponse, `EventSource` se reconnecte après le délai `retry` et envoie `Last-Event-ID`. Appelez `source.close()` lorsque vous avez terminé. Avec le point d’accès ci-dessus, cela affiche `tick 1 last id 1`, `tick 2 last id 2` et `tick 3 last id 3`.

## Garder la connexion active

Un mandataire ou un répartiteur de charge ferme une connexion qui reste silencieuse trop longtemps. Envoyez un événement de temps à autre, même sans rien à dire. `SseEvent` n’a pas de ligne de commentaire, mais un événement nommé avec des données vides fait l’affaire et ne coûte rien au navigateur : il n’atteint que les écouteurs enregistrés pour ce nom, de sorte que `onmessage` et `tick` ne le voient jamais.

```php
yield new SseEvent(data: '', event: 'heartbeat');
```

PHP s’aperçoit qu’un client est parti lorsqu’il écrit. Une boucle qui dort pendant des minutes entre les événements continuera de tourner longtemps après le départ du navigateur, alors gardez court l’intervalle entre les écritures et terminez le générateur lorsque votre propre source (une file, l’état d’une tâche) n’a plus rien à donner.

## Derrière un mandataire ou avec une session

### Le verrou de session

Le gestionnaire de sessions par fichiers de PHP, par défaut, verrouille la session pour toute la durée de la requête. Un flux qui détient la session fait attendre toutes les autres requêtes du même navigateur jusqu’à la fin du flux. Ignorez le middleware de session sur la route de diffusion, comme le fait l’exemple avec `#[WithoutMiddleware(SessionMiddleware::class)]`.

Avec le `SessionMiddleware` global monté, une requête simple envoyée pendant que le flux était ouvert a attendu 2,5 secondes, le reste du flux. La même requête avec l’attribut ci-dessus a répondu en 2 millisecondes. Ces chiffres sont mesurés avec `debug: false` : en développement, le débogage est activé par défaut et l’intégration de Tracy démarre une session (un témoin `tracy-session`), de sorte que le verrou subsiste même avec l’attribut. Si le flux a besoin de l’identité de l’utilisateur, lisez dans la session ce dont vous avez besoin avant de commencer à diffuser, ou authentifiez avec un jeton dans un middleware (voir [Authentification](../../fundamentals/authentication/)).

### Mise en tampon

`emit()` envoie `X-Accel-Buffering: no`, ce qui désactive la mise en tampon dans nginx pour la réponse. Les autres couches ont besoin de leur propre réglage : un cache de mandataire, un CDN ou la compression des réponses dans le serveur web peuvent tous retenir des événements jusqu’à ce que le tampon se remplisse. Désactivez la compression et la mise en tampon pour le chemin de diffusion, et testez à travers le vrai mandataire, pas seulement sur votre machine.

### Processus de travail

Un flux occupe un processus de travail PHP aussi longtemps qu’il dure. Un bassin de huit processus sert huit flux et rien d’autre. Le serveur intégré de PHP, démarré avec `php -S`, ne sert qu’une requête à la fois à moins de définir `PHP_CLI_SERVER_WORKERS` : un flux en développement bloque les pages que vous chargez pendant qu’il s’exécute.

### Middleware et en-têtes

Le flux démarre avant que le contrôleur ne retourne, de sorte que les en-têtes sont déjà envoyés lorsque le pipeline se déroule. Un middleware global qui ajoute des en-têtes à la réponse, comme les en-têtes de sécurité, n’a aucun effet sur une réponse diffusée. Montez le middleware qui doit agir avant le contrôleur (authentification, limitation de débit) et ne comptez pas sur la décoration.

## Bon à savoir

- Videz chaque tampon de sortie avant `emit()`, et utilisez `set_time_limit(0)` pour un flux de longue durée.
- Gardez le verrou de session hors du flux : ignorez `SessionMiddleware` sur la route.
- Authentifiez le point d’accès du flux comme n’importe quelle autre route. Il se trouve derrière votre pipeline habituel jusqu’au début de la diffusion.
- `event` et `id` tiennent chacun sur une ligne ; les sauts de ligne dans `data` sont acceptés.
- Envoyez un événement périodique pour que les mandataires ne coupent pas la connexion, et terminez le générateur lorsque le travail est fini.
- `SseEmitter::emit()` accepte un `Generator` de `SseEvent` : tout autre itérable doit y être enveloppé.
